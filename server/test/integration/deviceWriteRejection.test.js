'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EventEmitter = require('node:events');

function registerRuntime(setDeviceValue, errors) {
    const init = () => Promise.resolve();
    const dependencies = {
        bluebird: Promise,
        './events': require('../../runtime/events'),
        './utils': require('../../runtime/utils'),
        path,
        jsonwebtoken: require('jsonwebtoken'),
        './localization': { init },
        './storage/daqstorage': { init }
    };
    dependencies['./devices'] = {
        init,
        setDeviceValue,
        getDevicesValues: () => ({})
    };
    for (const name of ['project', 'users', 'apikeys', 'plugins',
        'scheduler/scheduler-storage', 'scheduler/scheduler-service',
        'recipes/recipe-storage', 'recipes/recipe-service']) {
        dependencies[`./${name}`] = { init };
    }
    for (const name of ['alarms', 'notificator', 'scripts', 'jobs']) {
        dependencies[`./${name}`] = { create: () => ({}) };
    }

    let connectionHandler;
    const io = { on(event, handler) {
        if (event === 'connection') connectionHandler = handler;
    } };
    const filename = path.join(__dirname, '../../runtime/index.js');
    const context = {
        module: { exports: {} },
        console,
        setInterval() {},
        setTimeout,
        clearTimeout,
        require(name) {
            assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
            return dependencies[name];
        }
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    context.module.exports.init(io, { authJwt: { getGuestToken: () => null } },
        { secureEnabled: false }, {
            info() {}, warn() {}, error(message) { errors.push(String(message)); }
        }, new EventEmitter());

    const handlers = new Map();
    const socket = {
        id: 'write-rejection-test',
        handshake: { query: {} },
        on(event, handler) { handlers.set(event, handler); },
        emit() {},
        disconnect() {}
    };
    connectionHandler(socket);
    return handlers;
}

describe('Socket.IO device write failures', () => {
    it('preserves a successful adapter write without logging an error', async () => {
        const errors = [];
        const writes = [];
        const handlers = registerRuntime(async (...args) => {
            writes.push(args);
            return true;
        }, errors);

        handlers.get('device-values')({
            cmd: 'set',
            var: { source: 'device-1', id: 'tag-1', value: 42 },
            fnc: ['scale', 42]
        });
        await new Promise(resolve => setImmediate(resolve));

        assert.deepEqual(writes, [['device-1', 'tag-1', 42, ['scale', 42]]]);
        assert.deepEqual(errors, []);
    });

    it('awaits a rejected adapter write and logs the failure', async () => {
        const errors = [];
        let writeConsumed = false;
        const rejectedWrite = {
            then(resolve, reject) {
                writeConsumed = true;
                reject(new Error('adapter write failed'));
            }
        };
        const handlers = registerRuntime(() => rejectedWrite, errors);

        handlers.get('device-values')({
            cmd: 'set',
            var: { source: 'device-1', id: 'tag-1', value: 42 }
        });
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(writeConsumed, true);
        assert.deepEqual(errors, ['device-values: Error: adapter write failed']);
    });
});
