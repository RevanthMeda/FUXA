'use strict';

// Fork-only check: restore the original get-device precedence in memory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const Mocha = require(require.resolve('mocha', { paths: [process.cwd()] }));
const target = path.resolve('integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-get-device.js');
const originalLoader = Module._extensions['.js'];
Module._extensions['.js'] = function(module, filename) {
    if (filename !== target) return originalLoader(module, filename);
    let source = fs.readFileSync(filename, 'utf8');
    const device = 'var deviceName = msg.deviceName || config.deviceName;';
    const tags = 'var includeTags = (msg.includeTags !== undefined) ? msg.includeTags : (config.includeTags !== undefined ? config.includeTags : true);';
    assert.ok(source.includes(device) && source.includes(tags), 'match both fixed selectors');
    source = source.replace(device, 'var deviceName = config.deviceName || msg.deviceName;')
        .replace(tags, 'var includeTags = (config.includeTags !== undefined) ? config.includeTags : (msg.includeTags !== undefined ? msg.includeTags : true);');
    module._compile(source, filename);
};
const suite = 'Node-RED get-device message overrides';
const expected = [
    `${suite} honors a false message override of the configured include-tags checkbox`,
    `${suite} honors a true message override of a tag-free configuration`,
    `${suite} targets the message device instead of the configured device`,
    `${suite} applies both documented overrides in the same message`,
    `${suite} reads successive selected summaries through the real helper without changing configuration`,
].sort();
const failed = [];
const mocha = new Mocha({ timeout: 10000, reporter: 'dot' });
mocha.addFile(path.resolve('test/authorization/nodeRedGetDeviceOverrides.test.js'));
const runner = mocha.run(failures => {
    Module._extensions['.js'] = originalLoader;
    assert.equal(failures, expected.length);
    assert.deepEqual(failed.sort(), expected);
    assert.equal(runner.stats.passes, 8);
    assert.equal(runner.stats.pending, 0);
    console.log('Negative validation PASS: five own regressions rejected original get-device precedence');
});
runner.on('fail', test => failed.push(test.fullTitle()));
