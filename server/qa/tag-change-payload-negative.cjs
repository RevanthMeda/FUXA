'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const Module = require('module');
const root = process.cwd();
const Mocha = require(path.join(root, 'node_modules/mocha'));
const target = path.join(root, 'integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-get-tag-change.js');
const original = Module._extensions['.js'];
let compiled = 0;
Module._extensions['.js'] = function(mod, filename) {
    if (filename !== target) return original(mod, filename);
    const source = fs.readFileSync(filename, 'utf8');
    const needle = 'payload: snapshotValue(currentValue),';
    assert.equal(source.split(needle).length, 2);
    compiled++;
    mod._compile(source.replace(needle, 'payload: currentValue,'), filename);
};
const expected = ['arrays', 'typed arrays', 'ByteStrings', 'nested ByteStrings']
    .map(name => 'isolates ' + name + ' sent to the first wire from live tag mutations').sort();
const failed = [];
const mocha = new Mocha({ reporter: 'spec', timeout: 10000 });
mocha.addFile(path.join(root, 'test/authorization/nodeRedTagChangeValues.test.js'));
const runner = mocha.run(failures => {
    Module._extensions['.js'] = original;
    assert.equal(compiled, 1);
    assert.equal(failures, 4);
    assert.equal(runner.stats.tests, 13);
    assert.equal(runner.stats.passes, 9);
    assert.equal(runner.stats.pending, 0);
    assert.deepEqual(failed.sort(), expected);
    console.log('Original payload alias rejected: four exact failures, nine compatibility passes.');
});
runner.on('fail', test => failed.push(test.title));
