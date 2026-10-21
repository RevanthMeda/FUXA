'use strict';
// Run from source/server. Mutate only the loaded node source, never files.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const sourceRequire = Module.createRequire(path.resolve('package.json'));
const Mocha = sourceRequire('mocha');
const targets = new Map([
    [sourceRequire.resolve('./integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-set-view'),
        ['var viewName = msg.viewName || config.viewName;', 'var viewName = config.viewName || msg.viewName;']],
    [sourceRequire.resolve('./integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-open-card'),
        ['var cardName = msg.cardName || config.cardName;', 'var cardName = config.cardName || msg.cardName;']],
]);
const originalCompile = Module.prototype._compile;
let compilations = 0;
Module.prototype._compile = function(source, filename) {
    if (targets.has(filename)) {
        const [before, after] = targets.get(filename);
        assert.equal(source.split(before).length - 1, 1);
        source = source.replace(before, after);
        compilations++;
    }
    return originalCompile.call(this, source, filename);
};
const expected = [];
for (const type of ['set-view', 'open-card']) {
    for (const title of [
        'uses the message name instead of the configured name',
        'selects each incoming message without changing the saved fallback',
    ]) expected.push('Node-RED ' + type + ' message overrides ' + title);
}
const mocha = new Mocha({ timeout: 10000, reporter: 'dot' });
mocha.addFile(path.resolve('test/authorization/nodeRedNavigationOverrides.test.js'));
const failed = [];
const runner = mocha.run(failures => {
    Module.prototype._compile = originalCompile;
    try {
        assert.equal(compilations, 2);
        assert.equal(failures, 4);
        assert.equal(runner.stats.tests, 20);
        assert.equal(runner.stats.passes, 16);
        assert.equal(runner.stats.pending, 0);
        assert.deepEqual(failed, expected);
        console.log('PASS: original selectors rejected by exactly 4 named cases; 16 compatibility passes; 2 nodes compiled; zero skipped.');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
});
runner.on('fail', test => failed.push(test.fullTitle()));
