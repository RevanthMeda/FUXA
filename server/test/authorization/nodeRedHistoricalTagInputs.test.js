'use strict';

const assert = require('node:assert/strict');
const register = require('../../integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-get-historical-tags');

function createNode(config = {}, query = async ids => Object.fromEntries(ids.map(id => [id, [{ x: 15, y: 0 }]]))) {
    const handlers = {}, calls = [], lookups = [], sent = [], errors = [], warnings = [];
    const ids = { Pressure: 'id-p', Flow: 'id-f' };
    const fuxa = {
        getTagId(name) { lookups.push(name); return ids[name]; },
        async getHistoricalTags(...args) { calls.push(args); return query(...args); },
    };
    let Constructor;
    register({ nodes: {
        registerType(type, ctor) { assert.equal(type, 'get-historical-tags'); Constructor = ctor; },
        createNode(node) {
            node.on = (event, handler) => { handlers[event] = handler; };
            node.context = () => ({ global: { get: name => name === 'fuxa' ? fuxa : undefined } });
            node.send = msg => sent.push(msg);
            node.error = (error, msg) => errors.push({ error, msg });
            node.warn = warning => warnings.push(warning);
        },
    } });
    new Constructor(config);
    return { input: msg => handlers.input(msg), calls, lookups, sent, errors, warnings };
}

describe('Node-RED historical tag message inputs', () => {
    it('uses message tags with the editor default empty JSON configuration', async () => {
        const node = createNode({ tags: '[]', from: 10, to: 20 });
        const msg = { tags: ['Flow'], correlationId: 'fixture' };
        await node.input(msg);
        assert.deepEqual(node.calls, [[['id-f'], 10, 20]]);
        assert.deepEqual(msg.payload, { Flow: [{ x: 15, y: 0 }] });
        assert.equal(msg.topic, 'Flow');
        assert.equal(msg.correlationId, 'fixture');
        assert.equal(node.sent[0], msg);
        assert.deepEqual(node.errors, []);
    });

    for (const tags of [['Flow'], '["Flow"]', 'Flow, Pressure']) {
        it(`overrides configured tags with message ${Array.isArray(tags) ? 'array' : tags.startsWith('[') ? 'JSON' : 'CSV'}`, async () => {
            const node = createNode({ tags: '["Pressure"]', from: 10, to: 20 });
            await node.input({ tags });
            assert.deepEqual(node.calls, [[tags === 'Flow, Pressure' ? ['id-f', 'id-p'] : ['id-f'], 10, 20]]);
            assert.equal(node.sent[0].topic, 'Flow');
            assert.deepEqual(node.errors, []);
        });
    }

    for (const tags of [undefined, null, '', '  ']) {
        it(`retains configured tags when message tags are ${JSON.stringify(tags)}`, async () => {
            const node = createNode({ tags: 'Pressure', from: 10, to: 20 });
            await node.input({ tags });
            assert.deepEqual(node.calls, [[['id-p'], 10, 20]]);
            assert.deepEqual(node.errors, []);
        });
    }

    for (const tags of [[], ['missing']]) {
        it(`does not fall back to configured tags for an explicit ${tags.length ? 'unknown' : 'empty'} message selection`, async () => {
            const node = createNode({ tags: '["Pressure"]', from: 10, to: 20 });
            const msg = { tags };
            await node.input(msg);
            assert.deepEqual(node.calls, []);
            assert.deepEqual(node.sent, []);
            assert.deepEqual(node.lookups, tags);
            assert.deepEqual(node.errors, [{ error: 'No valid tags found', msg }]);
        });
    }

    it('preserves configured and message inputs across successive selections', async () => {
        const config = Object.freeze({ tags: Object.freeze(['Pressure']), from: 10, to: 20 });
        const node = createNode(config);
        const msg = { tags: Object.freeze(['Flow']), from: 30, to: 40 };
        await node.input(msg);
        await node.input({});
        assert.deepEqual(node.calls, [[['id-f'], 30, 40], [['id-p'], 10, 20]]);
        assert.deepEqual(msg.tags, ['Flow']);
        assert.equal(msg.from, 30);
        assert.equal(msg.to, 40);
        assert.deepEqual(config, { tags: ['Pressure'], from: 10, to: 20 });
        assert.deepEqual(node.errors, []);
    });

    it('message timestamps override both configured endpoints', async () => {
        const node = createNode({ tags: 'Pressure', from: 10, to: 20 });
        await node.input({ from: 30, to: 40 });
        assert.deepEqual(node.calls, [[['id-p'], 30, 40]]);
    });

    it('preserves a zero-width epoch range', async () => {
        const node = createNode({ tags: 'Pressure', from: 10, to: 20 });
        await node.input({ from: 0, to: 0 });
        assert.deepEqual(node.calls, [[['id-p'], 0, 0]]);
    });

    it('interprets numeric timestamp strings as milliseconds', async () => {
        const node = createNode({ tags: 'Pressure' });
        await node.input({ from: '0', to: '1767225600000' });
        assert.deepEqual(node.calls, [[['id-p'], 0, 1767225600000]]);
    });

    it('converts ISO message timestamps with explicit offsets', async () => {
        const node = createNode({ tags: 'Pressure' });
        await node.input({ from: '2026-01-01T02:00:00+02:00', to: '2026-01-02T00:00:00Z' });
        assert.deepEqual(node.calls, [[['id-p'], Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2)]]);
    });

    it('retains configured editor date strings', async () => {
        const node = createNode({ tags: 'Pressure', from: '2026-01-01 00:00:00', to: '2026-01-02 00:00:00' });
        await node.input({});
        assert.deepEqual(node.calls, [[['id-p'], new Date('2026-01-01 00:00:00').getTime(), new Date('2026-01-02 00:00:00').getTime()]]);
    });

    it('overrides one endpoint independently', async () => {
        const node = createNode({ tags: 'Pressure', from: 10, to: 20 });
        await node.input({ to: 30 });
        assert.deepEqual(node.calls, [[['id-p'], 10, 30]]);
    });

    it('blank and null endpoints independently fall back to configuration', async () => {
        const node = createNode({ tags: 'Pressure', from: 10, to: 20 });
        await node.input({ from: '  ', to: null });
        assert.deepEqual(node.calls, [[['id-p'], 10, 20]]);
    });

    it('uses one clock sample for the default last-hour range', async () => {
        const originalNow = Date.now;
        let reads = 0;
        Date.now = () => { reads++; return 7200000; };
        try {
            const node = createNode({ tags: 'Pressure', from: '', to: '' });
            await node.input({});
            assert.deepEqual(node.calls, [[['id-p'], 3600000, 7200000]]);
            assert.equal(reads, 1);
        } finally { Date.now = originalNow; }
    });

    for (const [endpoint, value] of [['from', 'not-a-date'], ['from', NaN], ['from', Infinity], ['from', false], ['from', {}], ['from', []], ['to', 'not-a-date'], ['to', Infinity]]) {
        it(`rejects invalid ${endpoint} timestamp ${String(value)} (${typeof value}) before querying history`, async () => {
            const node = createNode({ tags: 'Pressure' });
            const msg = { from: 0, to: 100, [endpoint]: value };
            await node.input(msg);
            assert.deepEqual(node.calls, []);
            assert.deepEqual(node.sent, []);
            assert.equal(node.errors.length, 1);
            assert.match(String(node.errors[0].error), new RegExp('Invalid ' + endpoint + ' timestamp'));
            assert.equal(node.errors[0].msg, msg);
        });
    }

    it('rejects a reversed range before querying history', async () => {
        const node = createNode({ tags: 'Pressure' });
        const msg = { from: 20, to: 10 };
        await node.input(msg);
        assert.deepEqual(node.calls, []);
        assert.deepEqual(node.sent, []);
        assert.equal(node.errors.length, 1);
        assert.match(String(node.errors[0].error), /from timestamp must not exceed to timestamp/);
        assert.equal(node.errors[0].msg, msg);
    });

    it('reports asynchronous history failures against the same message', async () => {
        const failure = new Error('controlled history failure');
        const node = createNode({ tags: 'Pressure', from: 10, to: 20 }, async () => { throw failure; });
        const msg = {};
        await node.input(msg);
        assert.deepEqual(node.calls, [[['id-p'], 10, 20]]);
        assert.deepEqual(node.sent, []);
        assert.deepEqual(node.errors, [{ error: failure, msg }]);
    });
});
