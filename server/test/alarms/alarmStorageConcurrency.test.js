'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const storage = require('../../runtime/alarms/alarmstorage');

function alarm(id, overrides = {}) {
    return {
        getId: () => id, type: 'high', status: 'active',
        ontime: 1000, offtime: 0, acktime: 0, userack: '', value: 42,
        subproperty: { group: 'test', text: id }, ...overrides
    };
}

describe('Alarm storage concurrent transactions', () => {
    let workDir, errors;
    beforeEach(async () => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-alarm-transactions-'));
        errors = [];
        await storage.init({ workDir }, { info() {}, error: error => errors.push(error) });
    });
    afterEach(async () => {
        await storage.close();
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    it('persists every overlapping batch in current alarms and history', async () => {
        const results = await Promise.allSettled([
            storage.setAlarms([alarm('a'), alarm('b')]),
            storage.setAlarms([alarm('c')]),
            storage.setAlarms([alarm('d')])
        ]);
        assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled', 'fulfilled']);
        assert.deepEqual((await storage.getAlarms()).map(row => row.nametype).sort(), ['a', 'b', 'c', 'd']);
        assert.deepEqual((await storage.getAlarmsHistory()).map(row => row.nametype).sort(), ['a', 'b', 'c', 'd']);
        assert.deepEqual(errors, []);
    });

    it('keeps a failed batch rollback separate from the next successful batch', async () => {
        const invalid = alarm('invalid', { getId: () => { throw new Error('synthetic alarm failure'); } });
        const results = await Promise.allSettled([
            storage.setAlarms([alarm('rolled-back'), invalid]),
            storage.setAlarms([alarm('retained')])
        ]);
        assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled']);
        assert.deepEqual((await storage.getAlarms()).map(row => row.nametype), ['retained']);
        assert.deepEqual((await storage.getAlarmsHistory()).map(row => row.nametype), ['retained']);
        assert.equal(errors.length, 1);
        assert.match(errors[0], /synthetic alarm failure/);
        await storage.setAlarms([alarm('later')]);
        assert.equal((await storage.getAlarms()).length, 2);
    });

    it('applies an acknowledgement after the overlapping activation without duplicating history', async () => {
        const results = await Promise.allSettled([
            storage.setAlarms([alarm('same')]),
            storage.setAlarms([alarm('same', { status: 'acked', acktime: 2000, userack: 'operator' })])
        ]);
        assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled']);
        const current = await storage.getAlarms();
        const history = await storage.getAlarmsHistory();
        assert.equal(current.length, 1);
        assert.equal(history.length, 1);
        for (const rows of [current, history]) {
            assert.equal(rows[0].status, 'acked');
            assert.equal(rows[0].acktime, 2000);
        }
        assert.equal(history[0].userack, 'operator');
        assert.deepEqual(errors, []);
    });
});
