'use strict';

const assert = require('node:assert/strict');

describe('Node-RED send-message overrides', () => {
    const configured = { address: 'configured@example.invalid', subject: 'Configured subject', message: 'Configured body' };
    const requested = { address: 'requested@example.invalid', subject: 'Requested subject', message: 'Requested body' };

    function create(config = {}, sendMessage = async () => undefined) {
        const calls = [];
        const sent = [];
        const errors = [];
        const handlers = {};
        let Constructor;
        require('../../integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-send-message')({
            settings: { functionGlobalContext: { fuxa: {
                sendMessage(...args) {
                    calls.push(args);
                    return sendMessage(...args);
                },
            } } },
            nodes: {
                createNode(node) {
                    node.on = (event, callback) => { handlers[event] = callback; };
                    node.send = msg => sent.push(msg);
                    node.error = (error, msg) => errors.push({ error, msg });
                },
                registerType(name, ctor) {
                    assert.equal(name, 'send-message');
                    Constructor = ctor;
                },
            },
        });
        new Constructor(config);
        return { input: msg => handlers.input(msg), calls, sent, errors };
    }

    for (const field of ['address', 'subject', 'message']) {
        it(`uses the message ${field} instead of its configured value`, async () => {
            const config = Object.freeze({ ...configured });
            const node = create(config);
            const msg = { [field]: requested[field], topic: 'notification', extra: { retained: true } };
            const expected = { ...configured, [field]: requested[field] };
            await node.input(msg);
            assert.deepEqual(node.calls, [[expected.address, expected.subject, expected.message]]);
            assert.deepEqual(node.errors, []);
            assert.deepEqual(node.sent, [msg]);
            assert.equal(node.sent[0], msg);
            assert.deepEqual(msg, { [field]: requested[field], topic: 'notification', extra: { retained: true } });
            assert.deepEqual(config, configured);
        });
    }

    it('uses the payload instead of the configured body', async () => {
        const node = create(configured);
        const msg = { payload: 'Payload body' };
        await node.input(msg);
        assert.deepEqual(node.calls, [[configured.address, configured.subject, 'Payload body']]);
        assert.equal(node.sent[0], msg);
        assert.equal(msg.payload, 'Payload body');
        assert.deepEqual(node.errors, []);
    });

    it('prefers the explicit message body over the payload', async () => {
        const node = create(configured);
        const msg = { ...requested, payload: 'Payload body' };
        await node.input(msg);
        assert.deepEqual(node.calls, [[requested.address, requested.subject, requested.message]]);
        assert.equal(node.sent[0], msg);
        assert.equal(msg.payload, 'Payload body');
        assert.deepEqual(node.errors, []);
    });

    it('selects each incoming message without changing configured fallbacks', async () => {
        const config = Object.freeze({ ...configured });
        const node = create(config);
        for (const msg of [{ ...requested }, { address: 'second@example.invalid' }, {}]) await node.input(msg);
        assert.deepEqual(node.calls, [
            [requested.address, requested.subject, requested.message],
            ['second@example.invalid', configured.subject, configured.message],
            [configured.address, configured.subject, configured.message],
        ]);
        assert.equal(node.sent.length, 3);
        assert.deepEqual(node.errors, []);
        assert.deepEqual(config, configured);
    });

    for (const [label, value] of [['absent', undefined], ['empty', ''], ['null', null]]) {
        it(`keeps configured fallbacks for ${label} message fields`, async () => {
            const node = create(Object.freeze({ ...configured }));
            const msg = value === undefined ? {} : { address: value, subject: value, message: value, payload: value };
            await node.input(msg);
            assert.deepEqual(node.calls, [[configured.address, configured.subject, configured.message]]);
            assert.equal(node.sent[0], msg);
            assert.deepEqual(node.errors, []);
        });
    }

    it('supports message-only fields', async () => {
        const node = create();
        const msg = { ...requested };
        await node.input(msg);
        assert.deepEqual(node.calls, [[requested.address, requested.subject, requested.message]]);
        assert.equal(node.sent[0], msg);
        assert.deepEqual(node.errors, []);
    });

    it('supports a payload-only body without configured fields', async () => {
        const node = create();
        const msg = { address: requested.address, subject: requested.subject, payload: 'Payload body' };
        await node.input(msg);
        assert.deepEqual(node.calls, [[requested.address, requested.subject, 'Payload body']]);
        assert.equal(node.sent[0], msg);
        assert.deepEqual(node.errors, []);
    });

    for (const field of ['address', 'subject', 'message']) {
        it(`reports a missing ${field} without calling the notification helper`, async () => {
            const node = create();
            const msg = { ...requested };
            delete msg[field];
            await node.input(msg);
            assert.deepEqual(node.calls, []);
            assert.deepEqual(node.sent, []);
            assert.deepEqual(node.errors, [{ error: 'Missing address, subject, or message', msg }]);
            assert.equal(node.errors[0].msg, msg);
        });
    }

    it('reports a synchronous helper exception with the original message', async () => {
        const error = new Error('Controlled notification failure');
        const node = create(configured, () => { throw error; });
        const msg = {};
        await node.input(msg);
        assert.deepEqual(node.calls, [[configured.address, configured.subject, configured.message]]);
        assert.deepEqual(node.sent, []);
        assert.deepEqual(node.errors, [{ error, msg }]);
        assert.equal(node.errors[0].error, error);
        assert.equal(node.errors[0].msg, msg);
    });

    it('reports an asynchronous helper rejection with the original message', async () => {
        const error = new Error('Controlled async notification failure');
        const node = create(configured, async () => { throw error; });
        const msg = {};
        await node.input(msg);
        assert.deepEqual(node.calls, [[configured.address, configured.subject, configured.message]]);
        assert.deepEqual(node.sent, []);
        assert.deepEqual(node.errors, [{ error, msg }]);
        assert.equal(node.errors[0].error, error);
        assert.equal(node.errors[0].msg, msg);
    });

    it('waits for the notification helper before forwarding the original message', async () => {
        let resolve;
        const node = create(configured, () => new Promise(done => { resolve = done; }));
        const msg = { payload: null };
        const pending = node.input(msg);
        assert.deepEqual(node.calls, [[configured.address, configured.subject, configured.message]]);
        assert.deepEqual(node.sent, []);
        resolve(false);
        await pending;
        assert.deepEqual(node.sent, [msg]);
        assert.equal(node.sent[0], msg);
        assert.equal(msg.payload, null);
        assert.deepEqual(node.errors, []);
    });
});
