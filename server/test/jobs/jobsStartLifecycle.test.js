'use strict';
const assert = require('node:assert/strict');
const sinon = require('sinon');
const Jobs = require('../../runtime/jobs');

describe('jobs manager start lifecycle', function () {
    let sandbox, active, created, manager, loads;
    beforeEach(function () {
        sandbox = sinon.createSandbox();
        active = new Map(); created = []; loads = 0;
        sandbox.stub(global, 'setInterval').callsFake((callback, delay) => {
            const handle = { callback, delay };
            active.set(handle, callback); created.push(handle); return handle;
        });
        sandbox.stub(global, 'clearInterval').callsFake(handle => active.delete(handle));
        manager = Jobs.create({ events: {}, logger: { info() {}, warn() {}, error() {} },
            project: { getReports() { loads++; return Promise.resolve([]); } } });
    });
    afterEach(function () { sandbox.restore(); });
    async function assertStarted(promise) {
        let settled = false;
        promise.then(() => { settled = true; });
        await Promise.resolve();
        assert.equal(settled, true, 'start must settle after registering its timer');
    }
    it('settles start without waiting for a periodic check', async function () {
        await assertStarted(manager.start());
        assert.equal(created[0].delay, 5000); assert.equal(loads, 0);
        await manager.stop(); assert.equal(active.size, 0);
    });
    it('keeps one stoppable timer across repeated starts', async function () {
        manager.start(); manager.start();
        assert.equal(active.size, 1, 'repeated start must not orphan an interval');
        await manager.stop(); assert.equal(active.size, 0);
        await manager.stop(); assert.equal(active.size, 0);
    });
    it('restarts with one fresh timer and settled completion', async function () {
        manager.start(); await manager.stop();
        const first = created[0];
        await assertStarted(manager.start());
        assert.equal(active.has(first), false); assert.equal(active.size, 1);
        assert.equal(created.length, 2); await manager.stop();
    });
    it('retains timer-driven initialization and report loading', async function () {
        manager.start(); const tick = created[0].callback;
        tick(); // INIT -> LOAD after initialization settles
        await new Promise(resolve => setImmediate(resolve));
        tick(); // Actual manager LOAD with controlled project access
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(loads, 1); await manager.stop(); assert.equal(active.size, 0);
    });
    it('rejects timer registration failures', async function () {
        const error = new Error('controlled timer registration failure');
        global.setInterval.throws(error);
        await assert.rejects(manager.start(), value => value === error);
        await manager.stop(); assert.equal(active.size, 0);
    });
});
