'use strict';

const EventEmitter = require('events');
const Module = require('module');

describe('Modbus RTU shared-port characterization', () => {
    let originalLoad;
    let driver;
    let instances;

    before(async () => {
        const chai = await import('chai');
        global.expect = chai.expect;
    });

    beforeEach(() => {
        instances = [];
        originalLoad = Module._load;

        class MockModbusRTU {
            constructor() {
                this.isOpen = false;
                this.connectCalls = [];
                this.ids = [];
                instances.push(this);
            }

            connectRTU(address, options, callback) {
                this.connectCalls.push({ address, options });
                this.isOpen = true;
                callback();
            }

            connectRTUBuffered(address, options, callback) {
                this.connectRTU(address, options, callback);
            }

            connectAsciiSerial(address, options, callback) {
                this.connectRTU(address, options, callback);
            }

            setID(id) {
                this.ids.push(id);
            }

            setTimeout() {}

            close(callback) {
                this.isOpen = false;
                if (callback) callback();
            }
        }

        Module._load = function (request, parent, isMain) {
            if (request === 'modbus-serial') {
                return MockModbusRTU;
            }
            return originalLoad.apply(this, arguments);
        };

        const modulePath = require.resolve('../../runtime/devices/modbus');
        delete require.cache[modulePath];
        driver = require('../../runtime/devices/modbus');
    });

    afterEach(() => {
        Module._load = originalLoad;
        delete require.cache[require.resolve('../../runtime/devices/modbus')];
    });

    function createDevice(id, slaveid, runtime) {
        const data = {
            id,
            name: id,
            property: {
                address: 'COM3',
                baudrate: 9600,
                databits: 8,
                stopbits: 1,
                parity: 'none',
                slaveid,
                timeout: 1000,
                connectionOption: 'SerialPort',
                socketReuse: 'ReuseSerial'
            },
            tags: {}
        };

        const logger = {
            info() {},
            warn() {},
            error() {}
        };
        const events = new EventEmitter();
        const device = driver.create(data, logger, events, null, runtime);
        device.init(driver.ModbusTypes.RTU);
        return device;
    }

    it('opens a separate ModbusRTU client for each device even when sharing one serial address', async () => {
        const runtime = {
            socketMutex: new Map(),
            socketPool: new Map()
        };

        const slave1 = createDevice('slave-1', 1, runtime);
        const slave2 = createDevice('slave-2', 2, runtime);

        await slave1.connect();
        await slave2.connect();

        expect(instances).to.have.length(2);
        expect(instances[0].connectCalls).to.have.length(1);
        expect(instances[1].connectCalls).to.have.length(1);
        expect(instances[0].connectCalls[0].address).to.equal('COM3');
        expect(instances[1].connectCalls[0].address).to.equal('COM3');
        expect(instances[0].ids).to.deep.equal([1]);
        expect(instances[1].ids).to.deep.equal([2]);

        // The mutex is shared, but the physical RTU client/serial connection is not.
        expect(runtime.socketMutex.size).to.equal(1);
    });
});
