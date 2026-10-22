'use strict';
// Run from source/server. Restore only the original conversions in memory.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const sourceRequire = Module.createRequire(path.resolve('package.json'));
const Mocha = sourceRequire('mocha');
const driverPath = sourceRequire.resolve('./runtime/devices/s7');
const originalCompile = Module.prototype._compile;
let compilations = 0;
Module.prototype._compile = function(source, filename) {
    if (filename === driverPath) {
        for (const field of ['rack', 'slot']) {
            const before = '_parseConnectionIndex(data.property.' + field + ')';
            assert.equal(source.split(before).length - 1, 1);
            source = source.replace(before, 'parseInt(data.property.' + field + ', 10)');
        }
        compilations++;
    }
    return originalCompile.call(this, source, filename);
};
const expected = [];
for (const field of ['rack', 'slot']) {
    for (const label of [
        'trailing text', 'decimal text', 'negative fraction', 'positive fraction',
        'exponent text', 'hexadecimal text', 'unsafe integer', 'array',
    ]) expected.push('S7 rack and slot validation rejects ' + field + ' ' + label + ' before any native connection attempt');
}
const mocha = new Mocha({ timeout: 10000, reporter: 'dot' });
mocha.addFile(path.resolve('test/devices/s7ConnectionSettings.test.js'));
const failed = [];
const runner = mocha.run(failures => {
    Module.prototype._compile = originalCompile;
    try {
        assert.equal(compilations, 38);
        assert.equal(failures, 16);
        assert.equal(runner.stats.tests, 38);
        assert.equal(runner.stats.passes, 22);
        assert.equal(runner.stats.pending, 0);
        assert.deepEqual(failed, expected);
        console.log('PASS: original conversions rejected by exactly 16 named cases; 22 compatibility passes; 38 driver instances; zero skipped.');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
});
runner.on('fail', test => failed.push(test.fullTitle()));
