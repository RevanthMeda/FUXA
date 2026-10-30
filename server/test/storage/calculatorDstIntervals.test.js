'use strict';
const assert = require('node:assert/strict');
const calculator = require('../../runtime/storage/calculator');

function inTimezone(zone, fn) {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try { return fn(); } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
    }
}

describe('DAQ aggregation through daylight-saving transitions', function () {
    const periods = [
        ['repeated hour', 'America/New_York', '2026-11-01T01:00:00-04:00', '2026-11-01T01:00:00-05:00'],
        ['spring gap', 'America/New_York', '2026-03-08T01:00:00-05:00', '2026-03-08T03:00:00-04:00'],
        ['ordinary UTC hours', 'UTC', '2026-11-01T01:00:00Z', '2026-11-01T02:00:00Z']
    ];
    for (const [name, zone, first, second] of periods) {
        for (const interval of ['min5', 'min10', 'min15', 'min30', 'hour']) {
            for (const fnc of ['min', 'max', 'sum', 'average']) {
                it(`${fnc}/${interval} keeps distinct instants during ${name}`, function () {
                    inTimezone(zone, () => {
                        const a = Date.parse(first), b = Date.parse(second);
                        const result = calculator.getFunctionValues([{ dt: a, value: 2 }, { dt: b, value: 7 }], a, b + 60000, fnc, interval);
                        assert.equal(result[a], 2, 'first instant');
                        assert.equal(result[b], 7, 'second instant');
                        // Every intraday bucket advances by elapsed interval minutes.
                        const step = interval === 'hour' ? 60 : Number(interval.slice(3));
                        const keys = Object.keys(result).map(Number).sort((x, y) => x - y);
                        for (let i = 1; i < keys.length; i++) assert.equal(keys[i] - keys[i - 1], step * 60000);
                    });
                });
            }
        }
    }
    for (const [name, , first, second] of periods.slice(0, 2)) {
        for (const fnc of ['min', 'max', 'sum', 'average']) {
            it(`${fnc}/day preserves the local calendar day during ${name}`, function () {
                inTimezone('America/New_York', () => {
                    const a = Date.parse(first), b = Date.parse(second);
                    const day = new Date(a); day.setHours(0, 0, 0, 0);
                    const result = calculator.getFunctionValues([{ dt: a, value: 2 }, { dt: b, value: 7 }], day.getTime(), b + 60000, fnc, 'day');
                    assert.deepEqual(result, { [day.getTime()]: { min: 2, max: 7, sum: 9, average: 4.5 }[fnc] });
                });
            });
        }
    }
});
