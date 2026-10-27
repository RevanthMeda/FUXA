'use strict';
// Run from source/server. Restore the old selectors in memory, never on disk.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const sourceRequire = Module.createRequire(path.resolve('package.json'));
const Mocha = sourceRequire('mocha');
const target = sourceRequire.resolve(
    './integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-ack-alarm');
const originalCompile = Module.prototype._compile;
const current = [
    '                var alarmName = msg.alarmName || msg.payload || config.alarmName;',
    '                var types = (msg.types !== undefined && msg.types !== null) ? msg.types : config.types;',
].join('\n');
const original = [
    '                var alarmName = config.alarmName || msg.alarmName || msg.payload;',
    '                var types = config.types || msg.types;',
].join('\n');
let mutations = 0;
Module.prototype._compile = function (source, filename) {
    if (filename === target) {
        assert.equal(source.split(current).length - 1, 1);
        source = source.replace(current, original);
        mutations++;
    }
    return originalCompile.call(this, source, filename);
};
const expected = [
    'uses the message alarm name instead of the configured alarm',
    'uses a message payload alarm name instead of the configured alarm',
    'prefers the explicit message alarm name over the payload fallback',
    'uses message alarm types instead of the configured types',
    'preserves an empty message type list as an explicit override',
    'splits and trims a comma-separated message type override',
    'handles successive overrides without changing the configured fallback',
].map(title => 'Node-RED ack-alarm message overrides ' + title);
const mocha = new Mocha({ timeout: 10000, reporter: 'dot' });
mocha.addFile(path.resolve('test/authorization/nodeRedAckAlarmOverrides.test.js'));
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
        assert.equal(mutations, 1);
        assert.equal(failures, 7);
        assert.equal(runner.stats.tests, 12);
        assert.equal(runner.stats.passes, 5);
        assert.equal(runner.stats.pending, 0);
        assert.deepEqual(failed, expected);
        console.log('PASS: exactly seven named cases reject the original acknowledgement selectors; five compatibility cases pass, zero skipped.');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
});
runner.on('fail', test => failed.push(test.fullTitle()));
