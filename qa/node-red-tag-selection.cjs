'use strict';

// QA-only fixture. Runs real FUXA editor scripts and Node-RED 4.1.1 save hooks
// with jQuery in Chromium (or jsdom when FUXA_DOM_ONLY=1). The devices endpoint
// is replaced; this does not cover the full embedded editor or PLC hardware.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.FUXA_ROOT || path.resolve(__dirname, '..');
const nodes = path.join(root, 'server/integrations/node-red/node-red-contrib-fuxa/nodes');
const editorSource = fs.readFileSync(path.join(path.dirname(require.resolve('@node-red/editor-client')), 'public/red/red.js'), 'utf8');
const saveStart = editorSource.indexOf('    function handleEditSave(');
const saveEnd = editorSource.indexOf('\n    }\n', saveStart) + 7;
assert.ok(saveStart > 0 && saveEnd > saveStart);
const saveSource = editorSource.slice(saveStart, saveEnd) + '\nwindow.handleEditSave = handleEditSave;';
const paneStart = editorSource.lastIndexOf('(function()', editorSource.indexOf('RED.editor.registerEditPane("editor-tab-properties"'));
const paneEnd = editorSource.indexOf('\n})();', paneStart) + 6;
assert.ok(paneStart > 0 && paneEnd > paneStart);
const paneSource = editorSource.slice(paneStart, paneEnd);

async function run() {
    let browser;
    let dom;
    let page;
    const domOnly = process.env.FUXA_DOM_ONLY === '1';
    if (domOnly) {
        const { JSDOM } = require('jsdom');
        page = {
            async setContent(html) { if (dom) dom.window.close(); dom = new JSDOM(html, { runScripts: 'outside-only' }); },
            async addScriptTag({ path: filename, content }) { dom.window.eval(content || fs.readFileSync(filename, 'utf8')); },
            async evaluate(fn, args) { return dom.window.eval(`(${fn.toString()})(${JSON.stringify(args)})`); },
        };
    } else {
        browser = await require('playwright').chromium.launch({ headless: true });
        page = await browser.newPage();
    }
    let passed = 0;
    let failed = 0;
    try {
        for (const kind of ['get', 'set']) {
            const html = fs.readFileSync(path.join(nodes, `fuxa-${kind}-tag.html`), 'utf8');
            const script = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
            const template = html.match(/<script type="text\/x-red" data-template-name="[^"]+">([\s\S]*?)<\/script>/)[1];
            const cases = [
                { name: 'duplicate selection', value: 'Temperature(tag-b)', event: 'change', expected: ['Temperature', 'tag-b'] },
                { name: 'typed name', value: 'Pressure', event: 'change', expected: ['Pressure', ''] },
                { name: 'clear', value: '', event: 'input', expected: ['', ''] },
                { name: 'save without blur', value: 'Pressure', expected: ['Pressure', ''] },
                { name: 'device list unavailable', unavailable: true, expected: ['Temperature', 'tag-a'] },
                { name: 'late device list', late: true, value: 'Temperature(tag-b)', event: 'input', expected: ['Temperature', 'tag-b'] },
                { name: 'legacy name only', config: { tag: 'Temperature' }, expected: ['Temperature', ''] },
                { name: 'ID only', config: { tagId: 'tag-b' }, expected: ['', 'tag-b'] },
                { name: 'parentheses', value: 'Temperature (zone 2)(tag-b)', event: 'change', expected: ['Temperature (zone 2)', 'tag-b'] },
                { name: 'literal option text', literal: true, value: 'Temperature "<zone>&(tag-l)', event: 'change', expected: ['Temperature "<zone>&', 'tag-l'] },
            ];
            for (const test of cases) {
                try {
                    await page.setContent(template);
                    await page.addScriptTag({ path: require.resolve('jquery/dist/jquery.js') });
                    const result = await page.evaluate(({ script, paneSource, saveSource, test }) => {
                        const devices = [
                            { name: 'PLC A', tags: [{ name: 'Temperature', id: 'tag-a' }] },
                            { name: 'PLC B', tags: [{ name: 'Temperature', id: 'tag-b' }, { name: 'Pressure', id: 'tag-p' }] },
                            { name: 'PLC "<C>&', tags: [{ name: 'Temperature "<zone>&', id: 'tag-l' }] },
                        ];
                        window.RED = { nodes: { registerType(name, definition) { window.definition = definition; } },
                            editor: { registerEditPane(name, factory) { window.paneFactory = factory; } }, _: value => value };
                        let respond;
                        $.getJSON = (url, callback) => { respond = () => callback(devices); };
                        window.eval(script);
                        const config = Object.assign({ name: '', tag: '', tagId: '' }, test.config || { tag: 'Temperature', tagId: 'tag-a' });
                        config._def = window.definition;
                        config.type = 'test-node';
                        $('#node-input-name').val(config.name);
                        $('#node-input-tag').val(config.tag);
                        $('#node-input-tagId').val(config.tagId);
                        window.definition.oneditprepare.call(config);
                        if (!test.unavailable && !test.late) respond();
                        if ('value' in test) {
                            $('#node-input-tagSelected').val(test.value);
                            if (test.event) $('#node-input-tagSelected')[0].dispatchEvent(new Event(test.event, { bubbles: true }));
                        }
                        if (test.late) respond();
                        if (test.literal) {
                            const option = Array.from(document.querySelectorAll('datalist option')).find(option => option.value === test.value);
                            if (!option || option.textContent !== 'PLC "<C>& - Temperature "<zone>&') throw new Error('literal option value/text changed');
                        }
                        window.eval(paneSource);
                        window.eval(saveSource);
                        const state = { changes: {}, changed: false, outputMap: null };
                        window.handleEditSave(config, state);
                        const pane = window.paneFactory(config);
                        pane.inputClass = 'node-input';
                        pane.apply(state);
                        return [config.tag, config.tagId];
                    }, { script, paneSource, saveSource, test });
                    assert.deepEqual(Array.from(result), test.expected);
                    console.log(`PASS ${kind}: ${test.name}`);
                    passed++;
                } catch (error) {
                    console.error(`FAIL ${kind}: ${test.name}: ${error.message}`);
                    failed++;
                }
            }
        }
        console.log(JSON.stringify({ environment: domOnly ? 'jsdom + jQuery + Node-RED save hooks' : 'Chromium + jQuery + Node-RED save hooks', passed, failed }));
        if (failed) process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        if (dom) dom.window.close();
    }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
