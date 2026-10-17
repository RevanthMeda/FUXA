'use strict';

// Fork-only mutation check. No source file is written or test is skipped.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const Mocha = require(require.resolve('mocha', { paths: [process.cwd()] }));
const target = path.resolve('integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-enable-device.js');
const originalLoader = Module._extensions['.js'];
Module._extensions['.js'] = function(module, filename) {
    if (filename !== target) return originalLoader(module, filename);
    let source = fs.readFileSync(filename, 'utf8');
    const device = 'var deviceName = msg.deviceName || config.deviceName;';
    const enabled = 'var enabled = (msg.enabled !== undefined) ? msg.enabled : (config.enabled !== undefined ? config.enabled : true);';
    assert.ok(source.includes(device) && source.includes(enabled), 'mutation must match both fixed expressions');
    source = source.replace(device, 'var deviceName = config.deviceName || msg.deviceName;')
        .replace(enabled, 'var enabled = (config.enabled !== undefined) ? config.enabled : (msg.enabled !== undefined ? msg.enabled : true);');
    module._compile(source, filename);
};
const expected = [
    'honors a false message override of the configured enabled checkbox',
    'honors a true message override of a disabled configuration',
    'targets the message device instead of the configured device',
    'applies both documented overrides in the same message',
    'forwards successive overrides through the runtime helper without changing configuration',
];
const failed = [];
const mocha = new Mocha({ timeout: 10000, reporter: 'dot' });
mocha.addFile(path.resolve('test/authorization/nodeRedEnableDeviceOverrides.test.js'));
const runner = mocha.run(failures => {
    Module._extensions['.js'] = originalLoader;
    assert.equal(failures, expected.length);
    assert.deepEqual(failed, expected);
    console.log('Negative validation PASS: five own regressions rejected original precedence');
});
runner.on('fail', test => failed.push(test.title));
