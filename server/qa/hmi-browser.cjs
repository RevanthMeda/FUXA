'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const source = path.resolve(process.argv[2]);
const server = path.join(source, 'server');
const previous = 'b455853f7064a497c4f5bc9e780f6dbc713b8db4';
function loadModule(filename, code, overrides = {}) {
    const m = new Module(filename, module);
    m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
    m.require = request => Object.hasOwn(overrides, request) ? overrides[request] : Module.prototype.require.call(m, request);
    m._compile(code, filename); return m.exports;
}
async function project(svgcontent, old) {
    const filename = require.resolve(path.join(server, 'runtime/project'));
    const overrides = {};
    if (old) {
        const utils = path.join(server, 'runtime/utils.js');
        const code = execFileSync('git', ['show', previous + ':server/runtime/utils.js'], { cwd: source, encoding: 'utf8' });
        overrides['../utils'] = loadModule(utils, code);
    }
    overrides['./prjstorage'] = {
        TableType: Object.fromEntries(['GENERAL','VIEWS','DEVICES','TEXTS','ALARMS','RECIPES','NOTIFICATIONS','SCRIPTS','REPORTS','LOCATIONS','ARMARKERS'].map(n => [n,n])),
        init: async () => true,
        getSection: async t => t === 'VIEWS' ? [{ value: JSON.stringify({ id: 'v1', name: 'Synthetic controls', svgcontent,
            items: { group: { id: 'controlGroup', property: { events: [{ type: 'click' }] } } } }) }] : []
    };
    const result = loadModule(filename, fs.readFileSync(filename, 'utf8'), overrides);
    await result.init({}, { info() {}, error(e) { throw new Error(e); } }, {
        checkPermission: (permission, item) => permission === 'admin' ? {show:true,enabled:true} : {show:Boolean(item),enabled:false},
        scriptsMgr: {isAuthorised: () => false}
    });
    await result.load(); return result;
}
const fixtures = [
    ['ordinary controls', ''],
    ['empty SVG script', '<svg xmlns="http://www.w3.org/2000/svg"><script /></svg>'],
    ['empty SVG style', '<svg xmlns="http://www.w3.org/2000/svg"><style/></svg>']
];
async function main() {
    const previousDevices = process.env.DEVICES; delete process.env.DEVICES;
    let browser;
    try {
        if (!process.env.PREPARE_ONLY) {
            const { chromium } = require(path.join(process.env.BROWSER_QA_MODULES, 'playwright'));
            browser = await chromium.launch();
            console.log('Chromium ' + browser.version());
        }
        for (const old of process.env.PREPARE_ONLY ? [false] : [false, true]) {
            let failures = 0;
            for (const [name, prefix] of fixtures) {
                const original = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><g id="controlGroup"><foreignObject width="800" height="300"><div xmlns="http://www.w3.org/1999/xhtml">' + prefix +
                    '<select id="select"><option>A</option></select><input id="input" value="A"/><button id="button">Run</button></div></foreignObject></g></svg>';
                const prj = await project(original, old);
                const filtered = (await prj.getProject('viewer','viewer')).hmi.views[0].svgcontent;
                const view = (await prj.getProjectView('v1','viewer')).svgcontent;
                const admin = (await prj.getProject('admin','admin')).hmi.views[0].svgcontent;
                assert.equal(admin, original);
                assert.equal(view, filtered);
                if (!old) assert.equal((filtered.match(/ disabled/g) || []).length, 3);
                if (!browser) { console.log('Prepared actual project fixture: ' + name); continue; }
                const page = await browser.newPage();
                await page.route('**/*', route => route.abort());
                try {
                    for (const [kind, html] of [['admin',admin], ['restricted',filtered], ['single-view',view]]) {
                        await page.setContent(html);
                        const states = await page.locator('select,input,button').evaluateAll(nodes => nodes.map(n => ({
                            name:n.localName, namespace:n.namespaceURI, disabled:n.disabled, matches:n.matches(':disabled')
                        })));
                        assert.deepEqual(states.map(n => n.name), ['select','input','button']);
                        assert.ok(states.every(n => n.namespace === 'http://www.w3.org/1999/xhtml'));
                        const expected = kind !== 'admin';
                        const correct = states.every(n => n.disabled === expected && n.matches === expected);
                        if (old && expected && name !== 'ordinary controls') assert.equal(correct, false);
                        else assert.equal(correct, true, name + ': ' + kind);
                    }
                    if (old && name !== 'ordinary controls') failures++;
                    console.log((old ? 'Previous helper expected result: ' : 'PASS Chromium disabled state: ') + name);
                } finally { await page.close(); }
            }
            if (old) assert.equal(failures, 2);
        }
        console.log('PASS actual project output; no persisted project data or providers accessed');
    } finally {
        if (browser) await browser.close();
        if (previousDevices === undefined) delete process.env.DEVICES; else process.env.DEVICES = previousDevices;
    }
}
main().catch(e => { console.error(e); process.exitCode=1; });
