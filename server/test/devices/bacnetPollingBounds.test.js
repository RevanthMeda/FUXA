'use strict';

const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const Module = require('node:module');
const sinon = require('sinon');
const utils = require('../../runtime/utils');

describe('BACnet polling request bounds', function () {
    let sandbox, client, device, logger, deviceData;

    beforeEach(async function () {
        sandbox = sinon.createSandbox();
        client = new EventEmitter();
        client.close = sandbox.spy();
        client.readProperty = sandbox.stub();
        client.readPropertyMultiple = sandbox.stub();
        client.whoIs = () => client.emit('iAm', {
            payload: { deviceId: 123 }, header: { sender: { address: '127.0.0.2' } }
        });

        function ControlledBacnet() { return client; }
        ControlledBacnet.enum = {
            ApplicationTag: { ERROR: 105, REAL: 4 },
            ObjectType: {
                DEVICE: 8,
                ANALOG_INPUT: 0,
                ANALOG_OUTPUT: 1,
                ANALOG_VALUE: 2,
                BINARY_INPUT: 3,
                BINARY_OUTPUT: 4,
                BINARY_VALUE: 5
            },
            PropertyIdentifier: { OBJECT_LIST: 76, OBJECT_NAME: 77, PRESENT_VALUE: 85 }
        };

        const filename = require.resolve('../../runtime/devices/bacnet');
        delete require.cache[filename];
        const originalLoad = Module._load;
        sandbox.stub(Module, '_load').callsFake(function (request, parent) {
            if (request === 'node-bacnet' && parent.filename === filename) return ControlledBacnet;
            return originalLoad.apply(this, arguments);
        });
        sandbox.stub(utils, 'getNetworkInterfaces').returns(['127.0.0.1']);
        sandbox.stub(console, 'log');
        logger = { info: sandbox.spy(), warn: sandbox.spy(), error: sandbox.spy() };

        const tags = {};
        for (let i = 1; i <= 45; i++) {
            tags[`tag-${i}`] = {
                id: `tag-${i}`,
                name: `Tag ${i}`,
                address: `2-${i}`,
                memaddress: '123'
            };
        }
        deviceData = {
            name: 'BACnet bounded requests',
            property: { address: '127.0.0.1' },
            tags
        };
        device = require(filename).create(deviceData, logger, new EventEmitter());
        await device.connect();
        device.load(deviceData);
        logger.info.resetHistory();
    });

    afterEach(async function () {
        try { if (device) await device.disconnect(); }
        finally {
            sandbox.restore();
            delete require.cache[require.resolve('../../runtime/devices/bacnet')];
        }
    });

    it('polls large tag sets in bounded requests and retains every returned value', async function () {
        client.readPropertyMultiple.callsFake((address, requests, callback) => {
            if (requests.length > 20) {
                callback(new Error(`controlled BACnet abort for ${requests.length} objects`));
                return;
            }
            callback(null, { values: requests.map(request => ({
                objectId: request.objectId,
                values: [{ id: 85, value: [{ type: 4, value: Number(request.objectId.instance) }] }]
            })) });
        });

        await device.polling();

        assert.deepEqual(client.readPropertyMultiple.getCalls().map(call => call.args[1].length), [20, 20, 5]);
        assert.equal(device.getValue('tag-1').value, 1);
        assert.equal(device.getValue('tag-45').value, 45);
        sinon.assert.neverCalledWithMatch(logger.error, 'controlled BACnet abort');
    });

    it('keeps small polling sets in one request', async function () {
        const tags = Object.fromEntries(Object.entries(deviceData.tags).slice(0, 3));
        device.load({ ...deviceData, tags });
        client.readPropertyMultiple.callsFake((address, requests, callback) => callback(null, {
            values: requests.map(request => ({
                objectId: request.objectId,
                values: [{ id: 85, value: [{ type: 4, value: Number(request.objectId.instance) }] }]
            }))
        }));

        await device.polling();

        assert.deepEqual(client.readPropertyMultiple.getCalls().map(call => call.args[1].length), [3]);
        assert.equal(device.getValue('tag-3').value, 3);
    });
});
