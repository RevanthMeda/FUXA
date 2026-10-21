'use strict';
// Run from source/server. Restore old read behavior only in memory.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const sourceRequire = Module.createRequire(path.resolve('package.json'));
const Mocha = sourceRequire('mocha');
const driverPath = sourceRequire.resolve('./runtime/devices/s7');
const originalCompile = Module.prototype._compile;
let compilations = 0;
function replaceOnce(source, before, after) {
    assert.equal(source.split(before).length - 1, 1, before);
    return source.replace(before, after);
}
Module.prototype._compile = function (source, filename) {
    if (filename === driverPath) {
        compilations++;
        source = replaceOnce(source, `                // Native reads may still be running after another read rejects.
                // Settle the whole batch before disconnecting or starting a new poll.
                const settled = await Promise.allSettled(readVarsfnc);
                const failures = settled.filter(read => read.status === 'rejected');
                if (failures.length) {
                    const transportFailure = failures.find(read => read.reason && read.reason.connectionLost);
                    throw (transportFailure || failures[0]).reason;
                }
                const result = settled.map(read => read.value);`, '                const result = await Promise.all(readVarsfnc);');
        source = replaceOnce(source, `                if (reason && reason.connectionLost) {
                    try {
                        s7client.Disconnect();
                    } catch (err) {
                        logger.error(\`'\${data.name}' disconnect after read error failed! \${err}\`);
                    }
                    _emitStatus('connect-error');
                    _clearVarsValue();
                }
`, '');
        source = replaceOnce(source, `                    const reason = _getReadErr(err);
                    logger.error(\`'\${data.name}' \${err}: \${reason}\`, false);
                    if (reason.connectionLost) return reject(reason);`, "                    logger.error(`'${data.name}' ${err}: ${_getErr(err)}`, false);");
        source = replaceOnce(source, 'if (err) return reject(_getReadErr(err));', 'if (err) return reject(_getErr(err));');
    }
    return originalCompile.call(this, source, filename);
};
const expected = [];
for (const kind of ['db', 'multi']) for (const label of ['TCP', 'ISO', 'combined']) {
    expected.push(`S7 read connection recovery disconnects and clears ${kind} values after a ${label} read error, then reads after reconnect`);
}
expected.push('S7 read connection recovery still clears values and releases the poll when native disconnect throws');
for (const kind of ['db', 'multi']) expected.push(`S7 read connection recovery waits for outstanding reads before clearing values after an early ${kind} transport error`);
expected.push('S7 read connection recovery notices a later transport error even if another chunk failed with a client error first');
expected.push('S7 read connection recovery does not disconnect another S7 device sharing the same driver module');
expected.push('S7 read connection recovery lets the actual device state machine reconnect after transport loss');
const mocha = new Mocha({ timeout: 10000, reporter: 'dot' });
mocha.addFile(path.resolve('test/devices/s7ReadRecovery.test.js'));
const failed = [];
const runner = mocha.run(failures => {
    Module.prototype._compile = originalCompile;
    try {
        assert.equal(compilations, 16);
        assert.equal(failures, 12);
        assert.equal(runner.stats.tests, 16);
        assert.equal(runner.stats.passes, 4);
        assert.equal(runner.stats.pending, 0);
        assert.deepEqual(failed, expected);
        console.log('PASS: original read behavior rejected by exactly 12 named cases; 4 compatibility passes; 16 driver instances; zero skipped.');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
});
runner.on('fail', test => failed.push(test.fullTitle()));
