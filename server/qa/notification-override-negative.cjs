'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const sourceRequire = Module.createRequire(path.resolve('package.json'));
const Mocha = sourceRequire('mocha');
const target = sourceRequire.resolve('./integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-send-message');
const originalCompile = Module.prototype._compile;
let compilations = 0;
Module.prototype._compile = function(source, filename) {
    if (filename === target) {
        for (const [fixed, original] of [
            ['var address = msg.address || config.address;', 'var address = config.address || msg.address;'],
            ['var subject = msg.subject || config.subject;', 'var subject = config.subject || msg.subject;'],
            ['var message = msg.message || msg.payload || config.message;', 'var message = config.message || msg.message || msg.payload;'],
        ]) {
            assert.equal(source.split(fixed).length - 1, 1);
            source = source.replace(fixed, original);
        }
        compilations++;
    }
    return originalCompile.call(this, source, filename);
};
const expected = [
    "Node-RED send-message overrides uses the message address instead of its configured value",
    "Node-RED send-message overrides uses the message subject instead of its configured value",
    "Node-RED send-message overrides uses the message message instead of its configured value",
    "Node-RED send-message overrides uses the payload instead of the configured body",
    "Node-RED send-message overrides prefers the explicit message body over the payload",
    "Node-RED send-message overrides selects each incoming message without changing configured fallbacks"
];
const failed = [];
const mocha = new Mocha({ timeout: 10000, reporter: 'dot' });
mocha.addFile(path.resolve('test/authorization/nodeRedNotificationOverrides.test.js'));
const runner = mocha.run(failures => {
    Module.prototype._compile = originalCompile;
    try {
        assert.equal(compilations, 1);
        assert.equal(failures, 6);
        assert.equal(runner.stats.tests, 17);
        assert.equal(runner.stats.passes, 11);
        assert.equal(runner.stats.pending, 0);
        assert.deepEqual(failed, expected);
        console.log('PASS: original notification selectors rejected by exactly 6 named cases; 11 compatibility passes; 1 node compiled; zero skipped.');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
});
runner.on('fail', test => failed.push(test.fullTitle()));
