'use strict';
// Run from source/server. Mutate the driver in memory, never on disk.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const sourceRequire = Module.createRequire(path.resolve('package.json'));
const Mocha = sourceRequire('mocha');
const driverPath = sourceRequire.resolve('./runtime/devices/genericethernetip');
const originalCompile = Module.prototype._compile;
const expression = 'items[id] = tagValue;';
let mutations = 0;
Module.prototype._compile = function (source, filename) {
    if (filename === driverPath) {
        assert.equal(source.split(expression).length - 1, 1);
        mutations++;
        source = source.replace(expression,
            'items[id] = (Array.isArray(tagValue) || ArrayBuffer.isView(tagValue)) ? tagValue[0] : tagValue;');
    }
    return originalCompile.call(this, source, filename);
};
const expected = [];
for (const name of ['one-byte Buffer', 'multi-byte Buffer', 'one-element array', 'typed array']) {
    for (const action of ['preserves', 'passes to the read script']) {
        expected.push(`Generic EtherNet/IP device explicit response payload contract ${action} ${name}`);
    }
}
const mocha = new Mocha({ timeout: 10000, reporter: 'dot', grep: 'explicit response payload contract' });
mocha.addFile(path.resolve('test/devices/genericEthernetIp.test.js'));
try {
    mocha.loadFiles();
} catch (error) {
    Module.prototype._compile = originalCompile;
    throw error;
}
const failed = [];
const runner = mocha.run((failures) => {
    Module.prototype._compile = originalCompile;
    try {
        assert.equal(mutations, 9); // Initial driver plus eight isolated instances.
        assert.equal(failures, 8);
        assert.equal(runner.stats.tests, 8);
        assert.equal(runner.stats.passes, 0);
        assert.equal(runner.stats.pending, 0);
        assert.deepEqual(failed, expected);
        console.log('PASS: all eight exact payload-contract cases reject blind first-element conversion; zero skipped.');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
});
runner.on('fail', test => failed.push(test.fullTitle()));
