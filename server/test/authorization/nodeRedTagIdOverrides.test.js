'use strict';

const assert = require('node:assert/strict');
const register = require('../../integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-get-tag-id');

describe('Node-RED get-tag-id message overrides', () => {
    function create(config = {}, lookup = name => ({ Pressure: 'id-pressure', Flow: 'id-flow', Level: 'id-level' })[name] || null) {
        let Constructor;
        const handlers = {};
        const calls = [];
        const sent = [];
        const errors = [];
        register({
            settings: { functionGlobalContext: { fuxa: {
                getTagId(...args) { calls.push(args); return lookup(...args); },
            } } },
            nodes: {
                createNode(node) {
                    node.on = (event, callback) => { handlers[event] = callback; };
                    node.send = msg => sent.push(msg);
                    node.error = (error, msg) => errors.push({ error, msg });
                },
                registerType(type, ctor) {
                    assert.equal(type, 'get-tag-id');
                    Constructor = ctor;
                },
            },
        });
        new Constructor(config);
        return { input: msg => handlers.input(msg), calls, sent, errors };
    }

    it('resolves the message tag instead of the configured tag', async () => {
        const config = Object.freeze({ tagName: 'Pressure' });
        const node = create(config);
        const msg = { tagName: 'Flow', payload: 'before', topic: 'lookup', extra: { retained: true } };
        await node.input(msg);
        assert.deepEqual(node.calls, [['Flow', null]]);
        assert.deepEqual(msg, { tagName: 'Flow', payload: 'id-flow', topic: 'lookup', extra: { retained: true } });
        assert.equal(node.sent[0], msg);
        assert.equal(node.sent.length, 1);
        assert.deepEqual(node.errors, []);
        assert.deepEqual(config, { tagName: 'Pressure' });
    });

    it('resolves successive messages while preserving the configured fallback', async () => {
        const config = Object.freeze({ tagName: 'Pressure' });
        const node = create(config);
        for (const tagName of ['Flow', 'Level', undefined]) {
            await node.input(tagName === undefined ? {} : { tagName });
        }
        assert.deepEqual(node.calls, [['Flow', null], ['Level', null], ['Pressure', null]]);
        assert.deepEqual(node.sent.map(msg => msg.payload), ['id-flow', 'id-level', 'id-pressure']);
        assert.deepEqual(node.errors, []);
        assert.deepEqual(config, { tagName: 'Pressure' });
    });

    it('returns the unknown message lookup result without falling back to a configured tag', async () => {
        const node = create({ tagName: 'Pressure' });
        const msg = { tagName: 'Missing', payload: 'before' };
        await node.input(msg);
        assert.deepEqual(node.calls, [['Missing', null]]);
        assert.equal(msg.payload, null);
        assert.equal(node.sent[0], msg);
        assert.deepEqual(node.errors, []);
    });

    for (const [label, value] of [['absent', undefined], ['empty', ''], ['null', null]]) {
        it(`retains the configured tag for an ${label} message name`, async () => {
            const node = create(Object.freeze({ tagName: 'Pressure' }));
            const msg = value === undefined ? {} : { tagName: value };
            await node.input(msg);
            assert.deepEqual(node.calls, [['Pressure', null]]);
            assert.equal(msg.payload, 'id-pressure');
            assert.equal(node.sent[0], msg);
            assert.deepEqual(node.errors, []);
        });
    }

    it('supports a message-only tag name', async () => {
        const node = create();
        const msg = { tagName: 'Flow' };
        await node.input(msg);
        assert.deepEqual(node.calls, [['Flow', null]]);
        assert.equal(msg.payload, 'id-flow');
        assert.equal(node.sent[0], msg);
        assert.deepEqual(node.errors, []);
    });

    it('keeps the existing null result for an unknown configured tag', async () => {
        const node = create({ tagName: 'Missing' });
        const msg = { payload: 'before' };
        await node.input(msg);
        assert.deepEqual(node.calls, [['Missing', null]]);
        assert.equal(msg.payload, null);
        assert.equal(node.sent[0], msg);
        assert.deepEqual(node.errors, []);
    });

    it('reports a missing name without performing a lookup or changing the message', async () => {
        const node = create();
        const msg = { payload: 'before', topic: 'lookup' };
        await node.input(msg);
        assert.deepEqual(node.calls, []);
        assert.deepEqual(node.sent, []);
        assert.deepEqual(node.errors, [{ error: 'Tag name not specified', msg }]);
        assert.deepEqual(msg, { payload: 'before', topic: 'lookup' });
    });

    it('reports a lookup exception with the original message', async () => {
        const failure = new Error('controlled tag lookup failure');
        const node = create({ tagName: 'Pressure' }, () => { throw failure; });
        const msg = { payload: 'before' };
        await node.input(msg);
        assert.deepEqual(node.calls, [['Pressure', null]]);
        assert.deepEqual(node.sent, []);
        assert.deepEqual(node.errors, [{ error: failure, msg }]);
        assert.equal(msg.payload, 'before');
    });
});
