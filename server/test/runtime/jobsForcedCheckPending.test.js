'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const sinon = require('sinon');
const reports = require('../../runtime/jobs/report');
const cleaner = require('../../runtime/jobs/cleaner');
const jobs = require('../../runtime/jobs');

describe('Forced report checks while jobs are busy', function () {
    let sandbox, clock, poll, manager, calls, resolveFirst, rejectFirst;
    const settle = () => new Promise(resolve => setImmediate(resolve));
    beforeEach(async function () {
        sandbox = sinon.createSandbox(); calls = [];
        clock = sandbox.useFakeTimers({now: 1000000, toFake: ['Date']});
        sandbox.stub(global, 'setInterval').callsFake(callback => { poll = callback; return {}; });
        sandbox.stub(global, 'clearInterval');
        const first = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
        sandbox.stub(cleaner, 'create').returns({getProperty() { return null; }, execute() { return Promise.resolve(); }});
        sandbox.stub(reports, 'create').returns({getProperty() { return {id: 'report'}; },
            execute(date, force) { calls.push(force); return calls.length === 1 ? first : Promise.resolve(); }});
        manager = jobs.create({events: new EventEmitter(), logger: {info() {}, warn() {}, error() {}},
            project: {async getReports() { return [{id: 'report', scheduling: 'day'}]; }}});
        manager.start();
        poll(); await settle(); // initialize
        poll(); await settle(); // load jobs
        poll(); await settle(); // begin the controlled report execution
        assert.deepEqual(calls, [false]);
    });
    afterEach(async function () {
        try { resolveFirst(); await settle(); await manager.stop(); } finally { sandbox.restore(); }
    });
    for (const outcome of ['resolved', 'rejected']) {
        it('retains a forced report after the running check is ' + outcome, async function () {
            assert.equal(manager.forceReport({id: 'report'}), true);
            for (let i = 0; i < 3; i++) { clock.setSystemTime(Date.now() + 5000); poll(); await settle(); }
            assert.deepEqual(calls, [false], 'busy polls must not overlap report execution');
            if (outcome === 'rejected') rejectFirst(new Error('controlled report failure')); else resolveFirst();
            await settle();
            poll(); await settle();
            assert.deepEqual(calls, [false, true], 'the next idle poll must consume the pending force request');
            poll(); await settle();
            assert.equal(calls.length, 2, 'the force request must execute only once');
        });
    }
    it('preserves the regular check interval without a forced request', async function () {
        clock.setSystemTime(Date.now() + 5000); poll(); await settle();
        assert.deepEqual(calls, [false]);
        resolveFirst(); await settle(); poll(); await settle();
        assert.deepEqual(calls, [false]);
        clock.setSystemTime(Date.now() + 30 * 60 * 1000 + 1); poll(); await settle();
        assert.deepEqual(calls, [false, false]);
    });
    it('does not queue a force check for an unknown report', async function () {
        assert.equal(manager.forceReport({id: 'unknown'}), false);
        resolveFirst(); await settle(); poll(); await settle();
        assert.deepEqual(calls, [false]);
    });
});
