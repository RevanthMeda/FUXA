'use strict';

const assert = require('assert');
const http = require('http');
const EventEmitter = require('events');
const driver = require('../../runtime/devices/httprequest');

const gate = () => {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    return { promise, resolve };
};

describe('WebAPI polling lifecycle', function () {
    let server, address, requests, waiting, device, values, statuses, daq, errors;

    beforeEach(async function () {
        requests = [];
        waiting = [];
        server = http.createServer((req, res) => {
            requests.push(res);
            if (waiting.length) waiting.shift()(res);
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        address = `http://127.0.0.1:${server.address().port}`;
        values = []; statuses = []; daq = []; errors = [];
    });

    afterEach(async function () {
        if (device) await device.disconnect();
        for (const response of requests) if (!response.writableEnded) response.end('null');
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        device = null;
    });

    function config(mode, script = false) {
        return {
            id: 'webapi', name: 'WebAPI lifecycle', polling: 1000,
            property: mode === 'own' ? { getTags: address } : { address },
            tags: { reading: {
                id: 'reading', name: 'Reading', address: 'reading', type: 'number',
                daq: { enabled: true, changed: true },
                ...(script ? { scaleReadFunction: 'scale' } : {})
            } }
        };
    }

    async function start(mode, runtime, script = false) {
        const events = new EventEmitter();
        events.on('device-value:changed', event => values.push(JSON.parse(JSON.stringify(event.values))));
        events.on('device-status:changed', event => statuses.push(event.status));
        device = driver.create(config(mode, script), {
            info() {}, warn() {}, error(message) { errors.push(message); }
        }, events, runtime);
        device.bindAddDaq(batch => daq.push(JSON.parse(JSON.stringify(batch))));
        device.load(config(mode, script));
        await device.connect();
    }

    async function pendingPoll() {
        const request = new Promise(resolve => waiting.push(resolve));
        const completion = device.polling();
        return { response: await request, completion };
    }

    function reply(response, mode, value) {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(mode === 'own' ? [{ id: 'reading', value }] : { reading: value }));
    }

    for (const mode of ['own', 'external']) {
        it(`${mode}: ignores an HTTP response completed after disconnect`, async function () {
            await start(mode);
            const poll = await pendingPoll();
            await device.disconnect();
            const previousValues = values.length;
            reply(poll.response, mode, 42);
            await poll.completion;
            assert.strictEqual(device.getValue('reading'), null);
            assert.strictEqual(device.lastReadTimestamp(), undefined);
            assert.strictEqual(values.length, previousValues);
            assert.strictEqual(daq.length, 0);
            assert.strictEqual(device.getStatus(), 'connect-off');
        });

        it(`${mode}: preserves new readings when an older connection responds last`, async function () {
            await start(mode);
            const old = await pendingPoll();
            await device.disconnect();
            await device.connect();
            const current = await pendingPoll();
            reply(current.response, mode, 23);
            await current.completion;
            const previousValues = values.length;
            const previousDaq = daq.length;
            reply(old.response, mode, 99);
            await old.completion;
            assert.strictEqual(device.getValue('reading').value, 23);
            assert.strictEqual(values.length, previousValues);
            assert.strictEqual(daq.length, previousDaq);
        });

        it(`${mode}: ignores a scale result completed after disconnect`, async function () {
            const entered = gate(), release = gate();
            await start(mode, { scriptsMgr: { async runScript() {
                entered.resolve();
                return release.promise;
            } } }, true);
            const poll = await pendingPoll();
            reply(poll.response, mode, 7);
            await entered.promise;
            await device.disconnect();
            const previousValues = values.length;
            release.resolve(70);
            await poll.completion;
            assert.strictEqual(device.getValue('reading'), null);
            assert.strictEqual(values.length, previousValues);
            assert.strictEqual(daq.length, 0);
            assert.strictEqual(device.lastReadTimestamp(), undefined);
            assert.strictEqual(device.getStatus(), 'connect-off');
        });

        it(`${mode}: retains current polling, conversion and DAQ behavior`, async function () {
            await start(mode);
            const poll = await pendingPoll();
            reply(poll.response, mode, '0');
            await poll.completion;
            assert.strictEqual(device.getValue('reading').value, 0);
            assert.strictEqual(daq.length, 1);
            assert.strictEqual(daq[0].reading.value, 0);
            assert.strictEqual(typeof device.lastReadTimestamp(), 'number');
            assert.strictEqual(device.getStatus(), 'connect-ok');
        });

        it(`${mode}: preserves new readings when an older scale script resolves last`, async function () {
            const entered = gate(), release = gate();
            let calls = 0;
            await start(mode, { scriptsMgr: { async runScript(script) {
                if (++calls === 1) {
                    entered.resolve();
                    return release.promise;
                }
                return script.parameters[0].value;
            } } }, true);
            const old = await pendingPoll();
            reply(old.response, mode, 7);
            await entered.promise;
            await device.disconnect();
            await device.connect();
            const current = await pendingPoll();
            reply(current.response, mode, 23);
            await current.completion;
            const previousDaq = daq.length;
            release.resolve(70);
            await old.completion;
            assert.strictEqual(device.getValue('reading').value, 23);
            assert.strictEqual(daq.length, previousDaq);
        });
    }

    for (const outcome of ['success', 'failure']) {
        it(`a retired HTTP ${outcome} cannot release a newer poll's working flag`, async function () {
            await start('own');
            const old = await pendingPoll();
            await device.disconnect();
            await device.connect();
            const current = await pendingPoll();
            if (outcome === 'success') reply(old.response, 'own', 99);
            else old.response.destroy();
            await old.completion;
            const requestCount = requests.length;
            const extra = device.polling();
            // The busy path must resolve without issuing another HTTP request.
            await Promise.race([extra, new Promise(resolve => setImmediate(resolve))]);
            assert.strictEqual(device.getStatus(), 'connect-busy');
            assert.strictEqual(requests.length, requestCount);
            assert.strictEqual(errors.length, 0);
            reply(current.response, 'own', 23);
            await current.completion;
            await extra;
            assert.strictEqual(device.getValue('reading').value, 23);
        });
    }

    it('ignores an HTTP response for tags replaced by load', async function () {
        await start('own');
        const old = await pendingPoll();
        device.load({ ...config('own'), tags: {} });
        reply(old.response, 'own', 99);
        await old.completion;
        assert.strictEqual(device.getValue('reading'), null);
        assert.strictEqual(daq.length, 0);
        device.load(config('own'));
        const current = await pendingPoll();
        reply(current.response, 'own', 23);
        await current.completion;
        assert.strictEqual(device.getValue('reading').value, 23);
    });

    it('releases the current working flag after an HTTP failure', async function () {
        await start('own');
        const failed = await pendingPoll();
        failed.response.destroy();
        await failed.completion;
        assert.strictEqual(errors.length, 1);
        const retry = await pendingPoll();
        reply(retry.response, 'own', 42);
        await retry.completion;
        assert.strictEqual(device.getValue('reading').value, 42);
    });
});
