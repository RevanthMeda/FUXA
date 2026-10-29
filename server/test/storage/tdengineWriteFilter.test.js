'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const sdk = require('@tdengine/rest');
const storage = require('../../runtime/storage/tdengine');

describe('TDengine DAQ write filtering', function () {
    this.timeout(10000);
    let server, adapter, statements, pending, restored, errors, prototype, query;

    beforeEach(async function () {
        statements = [];
        pending = [];
        restored = [];
        errors = [];
        server = http.createServer((req, res) => {
            let sql = '';
            req.setEncoding('utf8');
            req.on('data', chunk => { sql += chunk; });
            req.on('end', () => {
                assert.equal(req.method, 'POST');
                statements.push(sql);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: [[1]], column_meta: [['affected_rows', 4, 4]] }));
            });
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        // Observe completion while forwarding every query through the real SDK
        // and HTTP transport. No query result or filter decision is mocked.
        prototype = Object.getPrototypeOf(sdk.connect({}).cursor());
        query = prototype.query;
        prototype.query = function (...args) {
            const result = query.apply(this, args);
            pending.push(result);
            return result;
        };
        let ready;
        const initialized = new Promise(resolve => { ready = resolve; });
        adapter = storage.create({ daqstore: {
            host: '127.0.0.1', port: server.address().port, database: 'synthetic',
            credentials: { username: 'synthetic', password: 'synthetic' }
        } }, { info: ready, error: message => errors.push(message) }, {
            setValues: values => restored.push(...values)
        });
        await initialized;
        assert.equal(statements.length, 2);
        assert.ok(statements.every(sql => sql.startsWith('CREATE ')));
        statements.length = 0;
        pending.length = 0;
    });

    afterEach(async function () {
        if (query) prototype.query = query;
        adapter?.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });

    const cases = [
        ['enabled number', 12, { enabled: true }, true, false],
        ['enabled zero', 0, { enabled: true }, true, false],
        ['enabled false', false, { enabled: true }, true, false],
        ['disabled number', 12, { enabled: false }, false, false],
        ['missing DAQ settings', 12, undefined, false, false],
        ['null reading', null, { enabled: true }, false, false],
        ['undefined reading', undefined, { enabled: true }, false, false],
        ['NaN reading', NaN, { enabled: true }, false, false],
        ['restored enabled reading', 12, { enabled: true, restored: true }, true, true],
        ['restored disabled reading', 12, { enabled: false, restored: true }, false, true],
        ['restored null reading', null, { enabled: false, restored: true }, false, true],
    ];

    for (const [name, value, daq, write, restore] of cases) {
        it(name, async function () {
            const tag = Object.freeze({ id: 'sample', value, daq: daq && Object.freeze(daq) });
            adapter.addDaqValues({ sample: tag }, 'device', 'device-id');
            await Promise.all(pending);
            assert.deepEqual(errors, []);
            assert.equal(statements.length, write ? 1 : 0);
            if (write) {
                assert.ok(statements[0].startsWith('INSERT INTO `synthetic`.`device-id`'));
                assert.ok(statements[0].includes(`VALUES (NOW, 'sample', '${value}')`));
            }
            assert.deepEqual(restored, restore ? [{ id: 'sample', deviceId: 'device-id', value }] : []);
        });
    }
});
