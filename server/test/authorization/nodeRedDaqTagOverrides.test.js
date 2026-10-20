'use strict';

const assert = require('node:assert/strict');
const { createNodeRedRuntimeHelpers } = require('../../integrations/node-red');

function createNode(kind, config, operation = async id => ({ id })) {
    const lookups = [];
    const calls = [];
    const sent = [];
    const errors = [];
    const devices = {
        getTagDaqSettings: (...args) => operation(...args),
        setTagDaqSettings: (...args) => operation(...args),
    };
    const helpers = createNodeRedRuntimeHelpers({}, devices);
    const method = kind === 'get' ? 'getTagDaqSettings' : 'setTagDaqSettings';
    const fuxa = {
        getTagId(name, device) {
            lookups.push([name, device]);
            return { Configured: 'configured-id', Message: 'message-id', Other: 'other-id' }[name];
        },
        [method](...args) {
            calls.push(args);
            return helpers[method](...args);
        },
    };
    let Constructor;
    const RED = {
        settings: { functionGlobalContext: { fuxa } },
        nodes: {
            createNode(node) {
                node.on = (event, handler) => {
                    if (event === 'input') node.input = handler;
                };
                node.send = msg => sent.push(msg);
                node.error = (error, msg) => errors.push({ error, msg });
            },
            registerType(name, ctor) {
                assert.equal(name, `${kind}-tag-daq-settings`);
                Constructor = ctor;
            },
        },
    };
    require(`../../integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-${kind}-tag-daq-settings`)(RED);
    return { node: new Constructor(config), lookups, calls, sent, errors };
}

for (const kind of ['get', 'set']) {
    describe(`Node-RED ${kind}-tag-daq-settings tag selection`, () => {
        it('uses the message tag instead of a configured tag ID', async () => {
            const fixture = createNode(kind, { tagId: 'configured-id', tag: 'Configured' });
            const msg = { tag: 'Message', topic: 'inspection' };
            await fixture.node.input(msg);
            assert.deepEqual(fixture.lookups, [['Message', null]]);
            assert.equal(fixture.calls[0][0], 'message-id');
            assert.equal(fixture.sent[0], msg);
            assert.deepEqual(msg.payload, { id: 'message-id' });
            assert.equal(msg.topic, 'inspection');
            assert.deepEqual(fixture.errors, []);
        });

        it('uses the message tag instead of a legacy configured tag name', async () => {
            const fixture = createNode(kind, { tag: 'Configured' });
            await fixture.node.input({ tag: 'Message' });
            assert.deepEqual(fixture.lookups, [['Message', null]]);
            assert.equal(fixture.calls[0][0], 'message-id');
        });

        it('does not fall back to the configured tag when a message override is unknown', async () => {
            const fixture = createNode(kind, { tagId: 'configured-id', tag: 'Configured' });
            const msg = { tag: 'Missing' };
            await fixture.node.input(msg);
            assert.deepEqual(fixture.lookups, [['Missing', null]]);
            assert.deepEqual(fixture.calls, []);
            assert.deepEqual(fixture.sent, []);
            assert.deepEqual(fixture.errors, [{ error: 'Tag not found: Missing', msg }]);
        });

        it('handles successive overrides without modifying the configured fallback', async () => {
            const config = { tagId: 'configured-id', tag: 'Configured' };
            const fixture = createNode(kind, config);
            for (const tag of ['Message', 'Other', undefined]) await fixture.node.input({ tag });
            assert.deepEqual(fixture.calls.map(args => args[0]), ['message-id', 'other-id', 'configured-id']);
            assert.deepEqual(config, { tagId: 'configured-id', tag: 'Configured' });
        });

        it('retains configured ID precedence without a nonempty message override', async () => {
            for (const tag of [undefined, null, '']) {
                const fixture = createNode(kind, { tagId: 'configured-id', tag: 'Other' });
                await fixture.node.input({ tag });
                assert.deepEqual(fixture.lookups, []);
                assert.equal(fixture.calls[0][0], 'configured-id');
            }
        });

        it('retains legacy configured-name and message-only flows', async () => {
            for (const [config, msg, expected] of [
                [{ tag: 'Configured' }, {}, 'configured-id'],
                [{}, { tag: 'Message' }, 'message-id'],
            ]) {
                const fixture = createNode(kind, config);
                await fixture.node.input(msg);
                assert.equal(fixture.calls[0][0], expected);
                assert.equal(fixture.sent[0], msg);
                assert.deepEqual(fixture.errors, []);
            }
        });

        it('reports absent selectors without a lookup or DAQ operation', async () => {
            const fixture = createNode(kind, {});
            const msg = {};
            await fixture.node.input(msg);
            assert.deepEqual(fixture.lookups, []);
            assert.deepEqual(fixture.calls, []);
            assert.deepEqual(fixture.sent, []);
            assert.equal(fixture.errors.length, 1);
            assert.equal(fixture.errors[0].msg, msg);
        });

        it('awaits the helper and preserves its result and message identity', async () => {
            let resolve;
            const fixture = createNode(kind, { tagId: 'configured-id' }, () => new Promise(done => { resolve = done; }));
            const msg = { payload: 'old', _msgid: 'daq-regression' };
            const pending = fixture.node.input(msg);
            assert.deepEqual(fixture.sent, []);
            resolve(false);
            await pending;
            assert.equal(fixture.sent[0], msg);
            assert.equal(msg.payload, false);
            assert.deepEqual(fixture.errors, []);
        });

        it('reports a rejected helper with the original message and no output', async () => {
            const failure = new Error('synthetic DAQ failure');
            const fixture = createNode(kind, { tagId: 'configured-id' }, async () => { throw failure; });
            const msg = {};
            await fixture.node.input(msg);
            assert.deepEqual(fixture.sent, []);
            assert.deepEqual(fixture.errors, [{ error: failure, msg }]);
        });
    });
}

describe('Node-RED DAQ settings value compatibility', () => {
    it('retains false and zero message settings while selecting a different tag', async () => {
        const config = { tagId: 'configured-id', enabled: true, interval: 1000, deadband: 5 };
        const fixture = createNode('set', config);
        await fixture.node.input({ tag: 'Message', enabled: false, interval: 0, deadband: 0 });
        assert.deepEqual(fixture.calls, [['message-id', { enabled: false, interval: 0, deadband: 0 }]]);
        assert.deepEqual(config, { tagId: 'configured-id', enabled: true, interval: 1000, deadband: 5 });
    });

    it('retains configured settings when the message provides no setting override', async () => {
        const fixture = createNode('set', { tagId: 'configured-id', enabled: false, interval: 0, deadband: 0 });
        await fixture.node.input({ enabled: undefined, interval: undefined, deadband: undefined });
        assert.deepEqual(fixture.calls, [['configured-id', { enabled: false, interval: 0, deadband: 0 }]]);
    });
});
