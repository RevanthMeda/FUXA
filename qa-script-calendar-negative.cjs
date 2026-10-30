// QA-only guard: confirm the tests reject the exact original runtime.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, 'source/server');
const runtime = path.join(source, 'runtime/scripts/index.js');
const fixed = fs.readFileSync(runtime);
const original = execFileSync('git', ['show', '2ab61639e982b449452a393c6a312dd21b00d13e:server/runtime/scripts/index.js'], { cwd: source });
try {
    fs.writeFileSync(runtime, original);
    const child = spawnSync(process.execPath, ['node_modules/mocha/bin/mocha.js', '--timeout', '10000', 'test/runtime/scriptCalendarStop.test.js', '--reporter', 'json'], {
        cwd: source, encoding: 'utf8', timeout: 30000, maxBuffer: 1000000
    });
    assert.ifError(child.error);
    const result = JSON.parse(child.stdout);
    assert.equal(child.status, 3, child.stderr);
    assert.equal(result.stats.tests, 4);
    assert.equal(result.stats.failures, 3);
    assert.equal(result.stats.passes, 1);
    assert.equal(result.stats.pending, 0);
    assert.deepEqual(result.failures.map(test => test.title), [
        'stop with the actual scheduler and compiled script',
        'repeated stop with the actual scheduler and compiled script',
        'restart with the actual scheduler and compiled script'
    ]);
    console.log('Original runtime: 3 expected failures, 1 compatibility pass, zero skips');
} finally {
    fs.writeFileSync(runtime, fixed);
    assert.deepEqual(fs.readFileSync(runtime), fixed);
}
