'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const storage = require('../../runtime/storage/influxdb');

describe('InfluxDB DAQ write eligibility', function () {
    this.timeout(10000);
    const cases = [
        ['missing DAQ configuration', 12, undefined, false, false],
        ['null reading', null, { enabled: true, restored: true }, false, false],
        ['undefined reading', undefined, { enabled: true, restored: true }, false, false],
        ['NaN reading', NaN, { enabled: true, restored: true }, false, false],
        ['disabled recording', 12, { enabled: false }, false, false],
        ['restore-only reading', 12, { enabled: false, restored: true }, false, true],
        ['zero reading', 0, { enabled: true, restored: true }, true, true],
        ['false reading', false, { enabled: true, restored: true }, true, true],
        ['ordinary reading', 12, { enabled: true }, true, false],
        ['enabled and restored reading', 12, { enabled: true, restored: true }, true, true]
    ];
    for (const type of ['influxDB18', 'influxDB']) {
        for (const [name, value, daq, written, restored] of cases) {
            it(`${type}: ${name} does not affect the following valid sample`, async function () {
                let receive;
                const received = new Promise(resolve => { receive = resolve; });
                const server = http.createServer((req, res) => {
                    let body = '';
                    req.setEncoding('utf8');
                    req.on('data', chunk => { body += chunk; });
                    req.on('end', () => { res.writeHead(204).end(); receive({ url: req.url, body }); });
                });
                await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
                const restores = [], errors = [];
                let timer;
                try {
                    const adapter = storage.create({ daqstore: {
                        type, url: `http://127.0.0.1:${server.address().port}`,
                        database: 'synthetic', organization: 'synthetic', bucket: 'synthetic',
                        credentials: { username: 'synthetic', password: '', token: 'synthetic' }
                    } }, { info() {}, error: message => errors.push(message) }, {
                        setValues: values => restores.push(...values)
                    });
                    adapter.addDaqValues({ candidate: { id: 'candidate', value, daq },
                        sentinel: { id: 'sentinel', value: 42, daq: { enabled: true } }
                    }, 'device', 'device-id');
                    const result = await Promise.race([received, new Promise((_, reject) => {
                        timer = setTimeout(() => reject(new Error(`No valid batch: ${errors.join('; ')}`)), 1000);
                    })]);
                    assert.match(result.url, /^\/(?:api\/v2\/)?write\?/);
                    const lines = result.body.trim().split('\n');
                    assert.equal(lines.length, written ? 2 : 1, result.body);
                    assert.ok(lines.some(line => /^sentinel[, ]/.test(line)), result.body);
                    const candidate = lines.find(line => /^candidate[, ]/.test(line));
                    assert.equal(Boolean(candidate), written, result.body);
                    if (written) {
                        const wire = value === false ? (type === 'influxDB18' ? '0' : 'F') : String(value);
                        assert.match(candidate, new RegExp(` value=${wire}(?:[i ]|$)`));
                    }
                    assert.deepEqual(restores, restored ? [{ id: 'candidate', deviceId: 'device-id', value }] : []);
                    assert.deepEqual(errors, []);
                } finally {
                    clearTimeout(timer);
                    server.closeAllConnections();
                    await new Promise(resolve => server.close(resolve));
                }
            });
        }
    }
});
