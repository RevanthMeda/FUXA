'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');

function gate() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function fixture({ initialization, writing, failWrite = false, failClose = false, failInit = false } = {}) {
    const events = [], rows = [], errors = [];
    const ready = gate(), started = gate();
    let current;
    const sender = {
        table(name) { current = { table: name }; return this; },
        symbol(name, value) { current[name] = value; return this; },
        stringColumn(name, value) { current[name] = value; return this; },
        floatColumn(name, value) { current[name] = value; return this; },
        async at(timestamp, precision) {
            const row = { ...current, timestamp, precision };
            started.resolve();
            if (writing) await writing.promise;
            if (failWrite) throw new Error('synthetic write failure');
            rows.push(row);
            events.push('row');
        },
        async flush() { events.push('flush'); },
        async close() {
            events.push('sender.close');
            if (failClose) throw new Error('synthetic close failure');
        }
    };
    class Pool {
        async query() { events.push('schema'); return { rows: [] }; }
        async end() { events.push('pool.end'); }
    }
    const path = require.resolve('../../runtime/storage/questdb');
    const load = Module._load;
    delete require.cache[path];
    Module._load = function (request) {
        if (request === 'pg') return { Pool };
        if (request === '@questdb/nodejs-client') return { Sender: { async fromConfig() {
            if (initialization) await initialization.promise;
            if (failInit) throw new Error('synthetic initialization failure');
            return sender;
        } } };
        return load.apply(this, arguments);
    };
    let adapter;
    try {
        adapter = require(path).create({ daqstore: {} }, {
            info() { ready.resolve(); }, warn() {}, error(message) {
                errors.push(message);
                if (message.startsWith('questdb-init failed')) ready.resolve();
            }
        });
    } finally {
        Module._load = load;
        delete require.cache[path];
    }
    const add = value => adapter.addDaqValues({ sample: {
        id: 'sample', value, timestamp: 1234, daq: { enabled: true }
    } }, 'device', 'device-id');
    return { adapter, add, events, rows, errors, ready, started };
}

describe('QuestDB close ordering', function () {
    it('waits for initialization before closing both late-created resources', async function () {
        const initialization = gate();
        const f = fixture({ initialization });
        const closing = f.adapter.close();
        try {
            assert.deepEqual(f.events, []);
        } finally {
            initialization.resolve();
            await f.ready.promise;
            await closing;
        }
        assert.deepEqual(f.events, ['schema', 'sender.close', 'pool.end']);
    });

    it('drains active and queued writes before closing the sender', async function () {
        const writing = gate();
        const f = fixture({ writing });
        await f.ready.promise;
        f.add(0);
        f.add(false);
        await f.started.promise;
        const closing = f.adapter.close();
        try {
            assert.deepEqual(f.events, ['schema']);
        } finally {
            writing.resolve();
            await closing;
        }
        assert.deepEqual(f.rows.map(row => row.number_value), [0, 0]);
        assert.deepEqual(f.events, ['schema', 'row', 'flush', 'row', 'flush', 'sender.close', 'pool.end']);
        assert.deepEqual(f.errors, []);
    });

    it('closes an idle initialized adapter', async function () {
        const f = fixture();
        await f.ready.promise;
        await f.adapter.close();
        assert.deepEqual(f.events, ['schema', 'sender.close', 'pool.end']);
        assert.deepEqual(f.errors, []);
    });

    it('shares close completion and ignores writes submitted after close', async function () {
        const f = fixture();
        await f.ready.promise;
        const first = f.adapter.close();
        assert.equal(f.adapter.close(), first);
        assert.ok(first instanceof Promise);
        f.add(12);
        await first;
        assert.deepEqual(f.rows, []);
        assert.deepEqual(f.events, ['schema', 'sender.close', 'pool.end']);
    });

    it('still closes both resources after a queued write fails', async function () {
        const f = fixture({ failWrite: true });
        await f.ready.promise;
        f.add(12);
        await f.started.promise;
        await f.adapter.close();
        assert.deepEqual(f.rows, []);
        assert.deepEqual(f.events, ['schema', 'sender.close', 'pool.end']);
        assert.equal(f.errors.length, 1);
        assert.match(f.errors[0], /questdb-addDaqValues failed.*synthetic write failure/);
    });

    it('logs a sender close rejection and still closes the query pool', async function () {
        const f = fixture({ failClose: true });
        await f.ready.promise;
        await f.adapter.close();
        assert.deepEqual(f.events, ['schema', 'sender.close', 'pool.end']);
        assert.equal(f.errors.length, 1);
        assert.match(f.errors[0], /questdb-close sender failed.*synthetic close failure/);
    });

    it('closes the query pool after sender initialization fails', async function () {
        const f = fixture({ failInit: true });
        await f.ready.promise;
        await f.adapter.close();
        assert.deepEqual(f.events, ['pool.end']);
        assert.equal(f.errors.length, 1);
        assert.match(f.errors[0], /questdb-init failed.*synthetic initialization failure/);
    });
});
