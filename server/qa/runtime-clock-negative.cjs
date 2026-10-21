'use strict';

// Run from the checked-out source/server directory. No source files are written.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createRequire } = Module;
const sourceRequire = createRequire(path.resolve('package.json'));
const Mocha = sourceRequire('mocha');
const target = path.resolve('test/help/runtimeUtils.test.js');
const originalLoader = Module._extensions['.js'];
const originalDate = global.Date;
const assertion = 'assert.equal(Utils.endTime(startTime), 0);';
let mutated = false;

Module._extensions['.js'] = function (module, filename) {
    if (filename !== target) return originalLoader(module, filename);
    const source = fs.readFileSync(filename, 'utf8');
    assert.equal(source.split(assertion).length - 1, 1);
    mutated = true;
    module._compile(source.replace(assertion, 'assert.equal(Utils.endTime(startTime), 9999);'), filename);
};

const mocha = new Mocha({ timeout: 10000, reporter: 'dot', grep: 'Utils.endTime' });
mocha.addFile(target);
try {
    mocha.loadFiles();
} finally {
    Module._extensions['.js'] = originalLoader;
}
const failedNames = [];
const runner = mocha.run((failures) => {
    try {
        assert.equal(mutated, true);
        assert.equal(failures, 1);
        assert.equal(runner.stats.tests, 1);
        assert.equal(runner.stats.passes, 0);
        assert.equal(runner.stats.pending, 0);
        assert.deepEqual(failedNames, [
            'Utils Help functions Utils.endTime returns the exact elapsed milliseconds without leaving asynchronous assertions'
        ]);
        assert.equal(global.Date, originalDate, 'the failing assertion must still restore Date');
        process.stdout.write('PASS: wrong elapsed value fails its own test and restores Date (1 expected failure, 0 skipped).\n');
    } catch (error) {
        process.stderr.write(`${error.stack}\n`);
        process.exitCode = 1;
    }
});
runner.on('fail', (test) => failedNames.push(test.fullTitle()));
