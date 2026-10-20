'use strict';
// Run from source/server. Restore the old selector in memory, never on disk.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const sourceRequire = Module.createRequire(path.resolve('package.json'));
const Mocha = sourceRequire('mocha');
const targets = new Set(['get', 'set'].map(kind => sourceRequire.resolve(
    './integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-' + kind + '-tag-daq-settings')));
const originalCompile = Module.prototype._compile;
const current = [
    '                // A message override must resolve independently of the configured ID.',
    '                var tagName = msg.tag || config.tag;',
    '                var tagId = msg.tag ? null : config.tagId;',
    '                if (!tagId) {',
    '                    if (tagName) {',
].join('\n');
const original = [
    '                // Prefer config.tagId, fallback to config.tag or msg.tag for backward compatibility',
    '                var tagId = config.tagId;',
    '                if (!tagId) {',
    '                    var tagName = config.tag || msg.tag;',
    '                    if (tagName) {',
].join('\n');
let mutations = 0;
Module.prototype._compile = function (source, filename) {
    if (targets.has(filename)) {
        assert.equal(source.split(current).length - 1, 1);
        assert.equal(source.split('(tagName || config.tagId)').length - 1, 1);
        source = source.replace(current, original)
            .replace('(tagName || config.tagId)', '(config.tag || msg.tag || config.tagId)');
        mutations++;
    }
    return originalCompile.call(this, source, filename);
};
const expected = [];
for (const kind of ['get', 'set']) {
    for (const title of [
        'uses the message tag instead of a configured tag ID',
        'uses the message tag instead of a legacy configured tag name',
        'does not fall back to the configured tag when a message override is unknown',
        'handles successive overrides without modifying the configured fallback',
    ]) expected.push('Node-RED ' + kind + '-tag-daq-settings tag selection ' + title);
}
expected.push('Node-RED DAQ settings value compatibility retains false and zero message settings while selecting a different tag');
const mocha = new Mocha({ timeout: 10000, reporter: 'dot' });
mocha.addFile(path.resolve('test/authorization/nodeRedDaqTagOverrides.test.js'));
try {
    mocha.loadFiles();
} catch (error) {
    Module.prototype._compile = originalCompile;
    throw error;
}
const failed = [];
const runner = mocha.run(failures => {
    Module.prototype._compile = originalCompile;
    try {
        assert.equal(mutations, 2);
        assert.equal(failures, 9);
        assert.equal(runner.stats.tests, 20);
        assert.equal(runner.stats.passes, 11);
        assert.equal(runner.stats.pending, 0);
        assert.deepEqual(failed, expected);
        console.log('PASS: exactly nine named cases reject both original DAQ selectors; eleven compatibility cases pass, zero skipped.');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
});
runner.on('fail', test => failed.push(test.fullTitle()));
