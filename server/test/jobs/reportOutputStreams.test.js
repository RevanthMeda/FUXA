'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const child = String.raw`
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Pdfmake = require('pdfmake');
const Report = require('./runtime/jobs/report');
const mode = process.argv[1];
const clock = require('sinon').useFakeTimers({ now: 1700000000000, toFake: ['Date'] });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuxa-report-output-'));
let observedPdf, output, outputClosed, sent = 0;
const create = Pdfmake.prototype.createPdfKitDocument;
Pdfmake.prototype.createPdfKitDocument = function (...args) {
    observedPdf = create.apply(this, args);
    if (mode === 'source-error') process.nextTick(() => observedPdf.destroy(Object.assign(new Error('controlled PDF source failure'), { code: 'PDF_SOURCE_TEST' })));
    return observedPdf;
};
const createWrite = fs.createWriteStream;
fs.createWriteStream = function (...args) {
    output = createWrite.apply(this, args);
    outputClosed = new Promise(resolve => output.once('close', resolve));
    return output;
};
const reportsDir = mode === 'missing-directory' ? path.join(root, 'missing') : root;
const runtime = {
    settings: { reportsDir }, logger: { info() {}, error() {} },
    notificatorMgr: { sendMailMessage() { sent++; return Promise.resolve(); } }
};
const property = { name: 'stream-test', receiver: 'operator@example.test', scheduling: 'none', docproperty: {}, content: { items: [{ type: 'text', text: 'Report stream contract', size: 12, align: 'left' }] } };
(async () => {
    try {
        if (mode === 'directory-target') {
            const utils = require('./runtime/utils');
            fs.mkdirSync(path.join(root, property.name + '_' + utils.getDate(new Date()) + '.pdf'));
        }
        const report = Report.create(property, runtime);
        if (mode === 'success') {
            const file = await report.execute(new Date(), true);
            const pdf = fs.readFileSync(file);
            assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
            assert.ok(pdf.includes(Buffer.from('%%EOF')));
            assert.equal(sent, 1);
        } else if (mode === 'content-error') {
            property.content = null;
            await assert.rejects(report.execute(new Date(), true), TypeError);
            assert.equal(sent, 0);
        } else {
            const expected = mode === 'missing-directory' ? 'ENOENT' : mode === 'directory-target' ? 'EISDIR' : 'PDF_SOURCE_TEST';
            await assert.rejects(report.execute(new Date(), true), error => error.code === expected);
            assert.equal(sent, 0);
            assert.equal(observedPdf.destroyed, true);
            assert.equal(output.destroyed, true);
            await outputClosed;
            assert.equal(output.closed, true);
            // Recover the owned output location and retry the same report.
            Pdfmake.prototype.createPdfKitDocument = create;
            if (mode === 'missing-directory') fs.mkdirSync(reportsDir);
            if (mode === 'directory-target') fs.rmSync(output.path, { recursive: true });
            const recovered = await report.execute(new Date(), true);
            assert.equal(fs.readFileSync(recovered).subarray(0, 5).toString(), '%PDF-');
            assert.equal(sent, 1);
        }
        console.log('REPORT_TEST_COMPLETED');
    } finally {
        Pdfmake.prototype.createPdfKitDocument = create;
        fs.createWriteStream = createWrite;
        clock.restore();
        fs.rmSync(root, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
`;

describe('PDF report output streams', () => {
    for (const mode of ['missing-directory', 'directory-target', 'source-error', 'success', 'content-error']) {
        it(`settles report execution and releases streams: ${mode}`, () => {
            const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', child, mode], {
                cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 10000
            });
            assert.ifError(result.error);
            assert.equal(result.signal, null, result.stderr);
            assert.equal(result.status, 0, result.stderr);
            assert.ok(result.stdout.includes('REPORT_TEST_COMPLETED'), result.stderr);
        });
    }
});
