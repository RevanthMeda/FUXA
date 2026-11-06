const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

// Execute the shipped uPlot adapter without starting Angular or a browser.
// The chart renderer is represented only at its documented addSeries/setData boundary.
function createRuntime() {
    const filename = path.join(__dirname, '../src/app/gui-helpers/ngx-uplot/ngx-uplot.component.ts');
    const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        fileName: filename,
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            experimentalDecorators: true
        },
        reportDiagnostics: true
    });
    assert.equal(diagnostics.length, 0);
    const decorator = () => () => {};
    const exports = {};
    const uPlot = {
        fmtDate: () => value => String(value),
        paths: {
            stepped: options => ({ type: 'stepped', options }),
            spline: () => ({ type: 'spline' })
        }
    };
    vm.runInNewContext(outputText, {
        exports,
        require: name => name === '@angular/core'
            ? { Component: decorator, Input: decorator, ViewChild: decorator }
            : {},
        console,
        uPlot
    }, { filename });

    const component = new exports.NgxUplotComponent();
    component.data = [[1, 2, 3, 4]];
    component.uplot = {
        series: [{}],
        addSeries(attribute, index) {
            this.series.splice(index, 0, attribute);
        },
        setData(data) {
            this.data = data;
        }
    };
    return component;
}

test('a lone non-null value gets a point marker when the shared x-axis is dense', () => {
    const component = createRuntime();
    const series = { label: 'single', lineInterpolation: component.lineInterpolations.linear };
    component.addSerie(1, series);

    const chart = { data: [[1, 2, 3, 4], [null, 42, null, null]] };
    assert.deepEqual(Array.from(series.points.filter(chart, 1, false)), [1]);
});

test('the marker fallback does not change normal multi-point rendering', () => {
    const component = createRuntime();
    const series = { label: 'normal', lineInterpolation: component.lineInterpolations.linear };
    component.addSerie(1, series);

    assert.equal(series.points.filter({ data: [[1, 2, 3], [10, 20, null]] }, 1, false), null);
    assert.equal(series.points.filter({ data: [[1, 2], [null, null]] }, 1, false), null);
    assert.equal(series.points.filter({ data: [[1], [10]] }, 1, true), null);
});

test('point-only interpolation retains its explicit point configuration', () => {
    const component = createRuntime();
    const series = {
        label: 'points',
        lineInterpolation: component.lineInterpolations.none,
        width: 6,
        stroke: '#123456',
        fill: '#abcdef'
    };
    component.addSerie(1, series);

    assert.equal(series.points.show, true);
    assert.equal(series.points.size, 6);
    assert.equal(series.points.stroke, '#123456');
    assert.equal(series.points.fill, '#abcdef');
    assert.equal(series.stroke, null);
    assert.equal(series.fill, null);
});
