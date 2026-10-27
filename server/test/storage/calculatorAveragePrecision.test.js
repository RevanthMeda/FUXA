const assert = require('assert');
const calculator = require('../../runtime/storage/calculator');

describe('DAQ average decimal precision', function () {
    for (const interval of ['min5', 'hour', 'day']) {
        for (const [label, values, format, expected] of [
            ['zero decimal places', [1.2, 1.6], 0, 1],
            ['zero decimal places rounds up', [1.6, 1.8], 0, 2],
            ['negative average at zero decimal places', [-1.2, -1.6], 0, -1],
            ['explicit fractional precision', [1.2, 1.7], 1, 1.4],
            ['omitted precision keeps five decimals', [1, 1.666666], undefined, 1.33333],
            ['null precision keeps five decimals', [1, 1.666666], null, 1.33333],
            ['integer averages stay integers', [2, 4], 0, 3],
        ]) {
            it(interval + ': ' + label, function () {
                const from = new Date(2026, 0, 15, 0, 0, 0).getTime();
                const samples = values.map((value, i) => ({dt: from + i * 1000, value}));
                const result = calculator.getFunctionValues(samples, from, from + 60000, 'average', interval, format);
                assert.deepStrictEqual(result, {[from]: expected});
            });
        }
    }
});
