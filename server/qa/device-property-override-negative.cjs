'use strict';

// Fork-only mutation check: restore one original node in memory, never write source.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const Mocha = require(require.resolve('mocha', { paths: [process.cwd()] }));
const type = process.argv[2];
assert.ok(['get', 'set'].includes(type), 'specify get or set');
const target = path.resolve(`integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-${type}-device-property.js`);
const originalLoader = Module._extensions['.js'];
Module._extensions['.js'] = function(module, filename) {
    if (filename !== target) return originalLoader(module, filename);
    let source = fs.readFileSync(filename, 'utf8');
    const device = 'var deviceName = msg.deviceName || config.deviceName;';
    const property = 'var property = msg.property || config.property;';
    assert.ok(source.includes(device) && source.includes(property), 'match both fixed selectors');
    source = source.replace(device, 'var deviceName = config.deviceName || msg.deviceName;')
        .replace(property, 'var property = config.property || msg.property;');
    module._compile(source, filename);
};
const suite = 'Node-RED device property message overrides';
const integration = type === 'get'
    ? 'reads successive selected devices and properties through the real helper without changing config'
    : 'writes only the selected device property through the real helper without changing config';
const expected = [
    `${suite} ${type}-device-property targets the message device instead of the configured device`,
    `${suite} ${type}-device-property uses the message property instead of the configured property`,
    `${suite} ${type}-device-property applies both documented selectors in one message`,
    `${suite} ${integration}`,
    `${suite} keeps ${type} message properties subject to the real helper allowlist`,
].sort();
const failed = [];
const mocha = new Mocha({ timeout: 10000, reporter: 'dot' });
mocha.addFile(path.resolve('test/authorization/nodeRedDevicePropertyOverrides.test.js'));
const runner = mocha.run(failures => {
    Module._extensions['.js'] = originalLoader;
    assert.equal(failures, expected.length);
    assert.deepEqual(failed.sort(), expected);
    assert.equal(runner.stats.passes, 16);
    assert.equal(runner.stats.pending, 0);
    console.log(`Negative validation PASS: five own regressions rejected original ${type} precedence`);
});
runner.on('fail', test => failed.push(test.fullTitle()));
