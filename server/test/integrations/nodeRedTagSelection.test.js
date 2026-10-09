'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const nodesPath = path.resolve(__dirname, '../../integrations/node-red/node-red-contrib-fuxa/nodes');
const devices = [
    { name: 'PLC A', tags: [{ name: 'Temperature', id: 'tag-a' }] },
    { name: 'PLC B', tags: [{ name: 'Temperature', id: 'tag-b' }, { name: 'Pressure', id: 'tag-p' }] },
];

// Execute the production editor hook with the field/API boundary replaced.
// Hidden defaults are populated as Node-RED does before oneditprepare.
function editor(kind, config, loadDevices = true) {
    const fields = new Map();
    function field(selector) {
        if (!fields.has(selector)) {
            fields.set(selector, {
                value: '', handlers: {}, children: [],
                val(value) { if (arguments.length) { this.value = value; return this; } return this.value; },
                text(value) { this.label = value; return this; },
                attr() { return this; },
                empty() { this.children = []; return this; },
                append(value) { this.children.push(value); return this; },
                on(events, handler) { events.split(' ').forEach(event => { this.handlers[event] = handler; }); return this; },
            });
        }
        return fields.get(selector);
    }
    const $ = selector => selector && typeof selector.val === 'function' ? selector :
        (selector === '<option>' ? field(Symbol()) : field(selector));
    let response;
    $.getJSON = (url, callback) => { assert.equal(url, '/nodered/fuxa/devices'); response = callback; };
    let definition;
    const source = fs.readFileSync(path.join(nodesPath, `fuxa-${kind}-tag.html`), 'utf8');
    vm.runInNewContext(source.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1], {
        $, RED: { nodes: { registerType(name, value) { assert.equal(name, `${kind}-tag`); definition = value; } } },
    });
    field('#node-input-tag').val(config.tag || '');
    field('#node-input-tagId').val(config.tagId || '');
    definition.oneditprepare.call(config);
    if (loadDevices) response(devices);
    return {
        field,
        respond: () => response(devices),
        edit(value, event = 'input') {
            const input = field('#node-input-tagSelected').val(value);
            if (input.handlers[event]) input.handlers[event].call(input);
        },
        save() {
            if (definition.oneditsave) definition.oneditsave.call(config);
            return { tag: field('#node-input-tag').val(), tagId: field('#node-input-tagId').val() };
        },
    };
}

async function input(kind, config, topic = 'Pressure') {
    const calls = [];
    const sent = [];
    const errors = [];
    let Constructor;
    require(path.join(nodesPath, `fuxa-${kind}-tag.js`))({
        nodes: {
            registerType(name, ctor) { Constructor = ctor; },
            createNode(node) {
                const emitter = new EventEmitter();
                node.on = emitter.on.bind(emitter);
                node.emit = emitter.emit.bind(emitter);
                node.send = msg => sent.push(msg);
                node.error = err => errors.push(err);
            },
        },
        settings: { functionGlobalContext: { fuxa: {
            getTagId(name) { calls.push(['resolve', name]); return name === 'Pressure' ? 'tag-p' : 'tag-a'; },
            getTag(id) { calls.push(['read', id]); return id === 'tag-b' ? 22 : 11; },
            async setTag(id, value) { calls.push(['write', id, value]); },
        } } },
    });
    const node = new Constructor(config);
    await new Promise((resolve, reject) => node.emit('input', { topic, payload: 99 }, null, err => err ? reject(err) : resolve()));
    assert.deepEqual(errors, []);
    assert.equal(sent.length, 1);
    return calls;
}

for (const kind of ['get', 'set']) {
    describe(`Node-RED ${kind}-tag editor/runtime contract`, () => {
        const original = () => ({ tag: 'Temperature', tagId: 'tag-a' });
        const operation = kind === 'get' ? 'read' : 'write';

        it('selects the second duplicate name by its ID', async () => {
            const ui = editor(kind, original());
            ui.edit('Temperature(tag-b)', 'change');
            const saved = ui.save();
            assert.deepEqual(saved, { tag: 'Temperature', tagId: 'tag-b' });
            const calls = await input(kind, saved);
            assert.equal(calls[0][0], operation);
            assert.equal(calls[0][1], 'tag-b');
        });

        it('typing a name discards the old ID and uses name resolution', async () => {
            const ui = editor(kind, original());
            ui.edit('Pressure', 'change');
            const saved = ui.save();
            assert.deepEqual(saved, { tag: 'Pressure', tagId: '' });
            const calls = await input(kind, saved);
            assert.deepEqual(calls[0], ['resolve', 'Pressure']);
            assert.equal(calls[1][1], 'tag-p');
        });

        it('clearing the field discards both defaults and uses msg.topic', async () => {
            const ui = editor(kind, original());
            ui.edit('');
            const saved = ui.save();
            assert.deepEqual(saved, { tag: '', tagId: '' });
            assert.deepEqual((await input(kind, saved))[0], ['resolve', 'Pressure']);
        });

        it('saves the visible value even without an input/change event', () => {
            const ui = editor(kind, original());
            ui.field('#node-input-tagSelected').val('Pressure');
            assert.deepEqual(ui.save(), { tag: 'Pressure', tagId: '' });
        });

        it('preserves a configured ID when the device-list request is unavailable', () => {
            const ui = editor(kind, original(), false);
            assert.equal(ui.field('#node-input-tagSelected').val(), 'Temperature(tag-a)');
            assert.deepEqual(ui.save(), original());
        });

        it('does not overwrite an edit when a delayed device list arrives', () => {
            const ui = editor(kind, original(), false);
            ui.edit('Temperature(tag-b)');
            ui.respond();
            assert.deepEqual(ui.save(), { tag: 'Temperature', tagId: 'tag-b' });
        });

        it('preserves legacy name-only flows without choosing a duplicate ID on edit', async () => {
            const ui = editor(kind, { tag: 'Temperature' });
            assert.deepEqual(ui.save(), { tag: 'Temperature', tagId: '' });
            assert.deepEqual((await input(kind, ui.save()))[0], ['resolve', 'Temperature']);
        });

        it('preserves ID-only imported configurations', async () => {
            const ui = editor(kind, { tagId: 'tag-b' });
            const saved = ui.save();
            assert.deepEqual(saved, { tag: '', tagId: 'tag-b' });
            assert.equal((await input(kind, saved))[0][1], 'tag-b');
        });

        it('preserves parentheses in tag names', () => {
            const ui = editor(kind, original());
            ui.edit('Temperature (zone 2)(tag-b)', 'change');
            assert.deepEqual(ui.save(), { tag: 'Temperature (zone 2)', tagId: 'tag-b' });
        });
    });
}
