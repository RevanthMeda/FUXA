'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const fs = require('node:fs');
const Module = require('node:module');
const driver = require('../../runtime/devices/genericethernetip');

describe('Generic EtherNet/IP device', function () {
    it('reads symbolic tag values as enumerable device values', async function () {
        class FakeController extends EventEmitter {
            async connect() { this.established_conn = true; }
            async disconnect() { this.established_conn = false; }
            newTag(name, program, dataType) { return { name, program, dataType, value: null }; }
            async readTagGroup(group) { group.tags.forEach(tag => { tag.value = 42; }); }
        }
        class FakeTagGroup {
            constructor() { this.tags = []; }
            add(tag) { this.tags.push(tag); }
            forEach(callback) { this.tags.forEach(callback); }
        }
        class FakeTag {
            constructor(name, program, dataType) {
                this.name = name;
                this.program = program;
                this.dataType = dataType;
                this.value = null;
            }
        }
        const events = new EventEmitter();
        const received = [];
        events.on('device-value:changed', event => received.push(event));
        const device = driver.create({
            id: 'device-1', name: 'PLC', property: { address: '127.0.0.1' },
            tags: {
                'tag-1': {
                    id: 'tag-1', name: 'Counter', address: 'Counter', type: 'number',
                    enipOptions: { tagType: 0, symbolicOpt: {} }
                }
            }
        }, { error() {}, debug() {}, info() {}, warn() {} }, events,
        { require: () => ({ Controller: FakeController, Tag: FakeTag, TagGroup: FakeTagGroup }) }, {});

        device.load({
            id: 'device-1', name: 'PLC', property: { address: '127.0.0.1' },
            tags: {
                'tag-1': {
                    id: 'tag-1', name: 'Counter', address: 'Counter', type: 'number',
                    enipOptions: { tagType: 0, symbolicOpt: {} }
                }
            }
        });
        await device.connect();
        await device.polling();

        assert.strictEqual(device.getValues()['tag-1'].value, 42);
        assert.strictEqual(received.length, 1);
        assert.strictEqual(Object.values(received[0].values).length, 1);
        assert.strictEqual(typeof device.lastReadTimestamp(), 'number');
        await device.disconnect();
    });

    it('supports the npm scanner API that binds on construction', async function () {
        class FakeController extends EventEmitter {
            async connect() { this.established_conn = true; }
            async disconnect() { this.established_conn = false; }
        }
        class FakeScanner {
            constructor() {
                this.connections = [];
                this.socket = new EventEmitter();
                this.socket.listening = false;
                this.socket.close = callback => {
                    this.socket.listening = false;
                    process.nextTick(callback);
                };
                process.nextTick(() => {
                    this.socket.listening = true;
                    this.socket.emit('listening');
                });
            }
            addConnection(_config, _rpi, _address, _port) {
                const ioConnection = new EventEmitter();
                ioConnection.connected = false;
                ioConnection.run = true;
                ioConnection.id = 'module-1';
                ioConnection.tcpController = new EventEmitter();
                ioConnection.tcpController.timeout_sp = 1000;
                ioConnection.tcpController.disconnect = async () => {};
                ioConnection.addInputInt = () => {};
                ioConnection.addInputBit = () => {};
                ioConnection.addOutputInt = () => {};
                ioConnection.addOutputBit = () => {};
                ioConnection.getValue = () => 321;
                ioConnection.setValue = () => {};
                this.connections.push(ioConnection);
                setTimeout(() => {
                    ioConnection.connected = true;
                    ioConnection.emit('connected');
                }, 20);
                return ioConnection;
            }
        }

        const data = {
            id: 'device-io', name: 'PLC I/O', property: { address: '127.0.0.1', ioport: 2222 },
            modules: {
                'module-1': {
                    id: 'module-1', rpi: 10,
                    configurationInstance: 102, configurationSize: 0,
                    outputInstance: 100, outputSize: 4,
                    inputInstance: 101, inputSize: 4
                }
            },
            tags: {
                'io-input': {
                    id: 'io-input', name: 'Input', type: 'number',
                    enipOptions: {
                        tagType: 2,
                        ioOpt: { ioModuleId: 'module-1', ioType: 1, ioByteOffset: 0, ioOutput: false }
                    }
                }
            }
        };
        const driverPath = require.resolve('../../runtime/devices/genericethernetip');
        delete require.cache[driverPath];
        const npmCompatibleDriver = require(driverPath);
        const device = npmCompatibleDriver.create(data, { error() {}, debug() {}, info() {}, warn() {} },
            new EventEmitter(), {
                require: () => ({ Controller: FakeController, IO: { Scanner: FakeScanner } })
            }, {});
        device.load(data);

        await device.connect();
        assert.strictEqual(device.isConnected(), true);
        await device.polling();
        assert.strictEqual(device.getValues()['io-input'].value, 321);
        await device.disconnect();
        assert.strictEqual(!!device.isConnected(), false);
    });
    describe('explicit response payload contract', function () {
        // Explicit attributes have no selected CIP datatype. Preserve their raw
        // response; a configured Read Scale Script can opt into interpretation.
        const payloads = [
            ['one-byte Buffer', () => Buffer.from([0])],
            ['multi-byte Buffer', () => Buffer.from([0, 1])],
            ['one-element array', () => [0]],
            ['typed array', () => new Uint8Array([0, 1])]
        ];

        for (const [name, makePayload] of payloads) {
            for (const withScript of [false, true]) {
                it(`${withScript ? 'passes to the read script' : 'preserves'} ${name}`, async function () {
                    const payload = makePayload();
                    const attributeCalls = [];
                    const scriptInputs = [];
                    const errors = [];
                    const received = [];
                    let symbolicReads = 0;
                    class FakeController extends EventEmitter {
                        async connect() { this.established_conn = true; }
                        async disconnect() { this.established_conn = false; }
                        async getAttributeSingle(...args) { attributeCalls.push(args); return payload; }
                        async readTagGroup() { symbolicReads++; throw new Error('Unexpected symbolic read'); }
                    }
                    // Isolate the driver's plugin variable and substitute only
                    // the transport library, even if a real plugin is installed.
                    const filename = require.resolve('../../runtime/devices/genericethernetip');
                    const sourceRequire = Module.createRequire(filename);
                    const isolated = new Module(filename, module);
                    isolated.filename = filename;
                    isolated.require = id => id === 'st-ethernet-ip' ? { Controller: FakeController } : sourceRequire(id);
                    isolated._compile(fs.readFileSync(filename, 'utf8'), filename);

                    const events = new EventEmitter();
                    events.on('device-value:changed', event => received.push(event));
                    const logger = { error(message) { errors.push(message); }, debug() {}, info() {}, warn() {} };
                    const runtime = {
                        logger,
                        scriptsMgr: {
                            async runScript(script, testMode) {
                                scriptInputs.push({ script, testMode });
                                return script.parameters[0].value[0];
                            }
                        }
                    };
                    const data = {
                        id: 'explicit-device', name: 'Synthetic adapter', property: { address: '127.0.0.1' },
                        tags: {
                            attribute: {
                                id: 'attribute', name: 'Raw attribute', type: 'number',
                                enipOptions: { tagType: 1, explicitOpt: { class: 1, instance: 1, attribute: 1, getOrSend: true } },
                                ...(withScript ? { scaleReadFunction: 'first-element' } : {})
                            }
                        }
                    };
                    const device = isolated.exports.create(data, logger, events, {}, runtime);
                    assert.ok(device);
                    device.load(data);
                    try {
                        await device.connect();
                        await device.polling();
                        assert.strictEqual(device.getValues().attribute.value, withScript ? 0 : payload);
                        assert.strictEqual(received.length, 1);
                        assert.strictEqual(received[0].values.attribute.value, withScript ? 0 : payload);
                        assert.deepStrictEqual(attributeCalls, [[1, 1, 1, undefined]]);
                        assert.strictEqual(symbolicReads, 0);
                        assert.strictEqual(scriptInputs.length, withScript ? 1 : 0);
                        if (withScript) {
                            assert.strictEqual(scriptInputs[0].script.id, 'first-element');
                            assert.strictEqual(scriptInputs[0].script.parameters[0].value, payload);
                            assert.strictEqual(scriptInputs[0].testMode, false);
                        }
                        assert.deepStrictEqual(errors, []);
                    } finally {
                        await device.disconnect();
                    }
                });
            }
        }
    });
});
