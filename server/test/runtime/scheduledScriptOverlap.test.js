'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const fixture = String.raw`
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const sinon = require('sinon');
const schedule = require('node-schedule');
const scripts = require('./runtime/scripts');
const mode = process.argv[1];
(async () => {
    const sandbox = sinon.createSandbox();
    const calls = [];
    const pending = [];
    const callbacks = [];
    let poll;
    let manager;
    try {
        sandbox.stub(global, 'setInterval').callsFake(callback => { poll = callback; return {}; });
        sandbox.stub(global, 'clearInterval');
        sandbox.stub(schedule, 'scheduleJob').callsFake((rule, callback) => {
            callbacks.push(callback);
            return { cancel() {} };
        });
        sandbox.useFakeTimers({ now: 10000, toFake: ['Date'] });

        const makeScript = (id, tag) => ({
            id,
            name: id,
            mode: 'SERVER',
            parameters: [],
            sync: false,
            code: "return $setTag('" + tag + "', true);",
            scheduling: mode === 'cron'
                ? { mode: 'scheduling', schedules: [{ type: 1, minute: 5 }] }
                : { mode: 'interval', interval: 1 }
        });
        const projectScripts = mode === 'independent'
            ? [makeScript('first', 'first'), makeScript('second', 'second')]
            : [makeScript('scheduled', 'executed')];

        manager = scripts.create({
            events: new EventEmitter(),
            settings: {},
            logger: { info() {}, warn() {}, error(error) { throw error; } },
            devices: {
                setTagValue(tag, value) {
                    calls.push([tag, value]);
                    return new Promise(resolve => pending.push(resolve));
                }
            },
            project: { async getScripts() { return projectScripts; } }
        });

        const settle = () => new Promise(resolve => setImmediate(resolve));
        manager.start();
        poll(); await settle();
        poll(); await settle();

        if (mode === 'cron') {
            assert.equal(callbacks.length, 1);
            callbacks[0](); await settle();
            callbacks[0](); await settle();
        } else {
            sandbox.clock.setSystemTime(12000);
            poll(); await settle();
            sandbox.clock.setSystemTime(14000);
            poll(); await settle();
        }

        const expectedFirstWave = mode === 'independent'
            ? [['first', true], ['second', true]]
            : [['executed', true]];
        assert.deepEqual(calls, expectedFirstWave,
            'a pending scheduled script must not start another execution');

        pending.splice(0).forEach(resolve => resolve(true));
        await settle(); await settle();

        if (mode === 'cron') {
            callbacks[0](); await settle();
        } else {
            sandbox.clock.setSystemTime(16000);
            poll(); await settle();
        }
        assert.deepEqual(calls, expectedFirstWave.concat(expectedFirstWave),
            'the next tick must run after the prior execution settles');
        pending.splice(0).forEach(resolve => resolve(true));
        await settle(); await settle();
    } finally {
        if (manager) await manager.stop();
        sandbox.restore();
    }
    console.log('ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
`;

describe('Scheduled script overlap control', function () {
    for (const mode of ['interval', 'cron', 'independent']) {
        it(`${mode}: keeps each scheduled script to one in-flight execution`, function () {
            const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', fixture, mode], {
                cwd: path.resolve(__dirname, '../..'),
                env: { PATH: process.env.PATH },
                encoding: 'utf8',
                timeout: 4000,
                maxBuffer: 16000
            });
            assert.ifError(child.error);
            assert.equal(child.status, 0, child.stderr);
            assert.equal(child.stdout.trim(), 'ok');
        });
    }
});
