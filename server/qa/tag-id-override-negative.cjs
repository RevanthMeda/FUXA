'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const sourceRequire = Module.createRequire(path.resolve('package.json'));
const Mocha = sourceRequire('mocha');
const target = sourceRequire.resolve('./integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-get-tag-id');
const originalCompile = Module.prototype._compile;
let compilations = 0;
Module.prototype._compile = function(source, filename) {
    if (filename === target) {
        const fixed = 'var tagName = msg.tagName || config.tagName;';
        assert.equal(source.split(fixed).length - 1, 1);
        source = source.replace(fixed, 'var tagName = config.tagName || msg.tagName;');
        compilations++;
    }
    return originalCompile.call(this, source, filename);
};
const prefix = 'Node-RED get-tag-id message overrides ';
const expected = [
    'resolves the message tag instead of the configured tag',
    'resolves successive messages while preserving the configured fallback',
    'returns the unknown message lookup result without falling back to a configured tag',
].map(title => prefix + title);
const failed = [];
const mocha = new Mocha({ timeout: 10000, reporter: 'dot' });
mocha.addFile(path.resolve('test/authorization/nodeRedTagIdOverrides.test.js'));
const runner = mocha.run(failures => {
    Module.prototype._compile = originalCompile;
    try {
        assert.equal(compilations, 1);
        assert.equal(failures, 3);
        assert.equal(runner.stats.tests, 10);
        assert.equal(runner.stats.passes, 7);
        assert.equal(runner.stats.pending, 0);
        assert.deepEqual(failed, expected);
        console.log('PASS: original tag selector rejected by exactly 3 named cases; 7 compatibility passes; 1 node compiled; zero skipped.');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
});
runner.on('fail', test => failed.push(test.fullTitle()));
