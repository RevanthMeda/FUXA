'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const sourceRequire = Module.createRequire(path.resolve('package.json'));
const Mocha = sourceRequire('mocha');
const target = sourceRequire.resolve('./integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-get-historical-tags');
const originalCompile = Module.prototype._compile;
let compilations = 0;
const replacements = [
    [
        "var tags = hasValue(msg.tags) ? msg.tags : config.tags;",
        "var tags = config.tags || msg.tags;"
    ],
    [
        "                var now = Date.now();\n                var fromts = timestamp(msg.from, config.from, now - 3600000, 'from');\n                var tots = timestamp(msg.to, config.to, now, 'to');\n                if (fromts > tots) {\n                    throw new Error('Invalid historical range: from timestamp must not exceed to timestamp');\n                }\n\n",
        "                var fromts = config.from || msg.from || Date.now() - 3600000; // default 1 hour ago\n                var tots = config.to || msg.to || Date.now();\n\n                // Convert string timestamps to numbers if needed\n                if (typeof fromts === 'string') {\n                    fromts = new Date(fromts).getTime();\n                }\n                if (typeof tots === 'string') {\n                    tots = new Date(tots).getTime();\n                }\n\n"
    ]
];
Module.prototype._compile = function(source, filename) {
    if (filename === target) {
        for (const [fixed, original] of replacements) {
            assert.equal(source.split(fixed).length - 1, 1);
            source = source.replace(fixed, original);
        }
        compilations++;
    }
    return originalCompile.call(this, source, filename);
};
const expected = [
    "Node-RED historical tag message inputs uses message tags with the editor default empty JSON configuration",
    "Node-RED historical tag message inputs overrides configured tags with message array",
    "Node-RED historical tag message inputs overrides configured tags with message JSON",
    "Node-RED historical tag message inputs overrides configured tags with message CSV",
    "Node-RED historical tag message inputs does not fall back to configured tags for an explicit empty message selection",
    "Node-RED historical tag message inputs does not fall back to configured tags for an explicit unknown message selection",
    "Node-RED historical tag message inputs preserves configured and message inputs across successive selections",
    "Node-RED historical tag message inputs message timestamps override both configured endpoints",
    "Node-RED historical tag message inputs preserves a zero-width epoch range",
    "Node-RED historical tag message inputs interprets numeric timestamp strings as milliseconds",
    "Node-RED historical tag message inputs overrides one endpoint independently",
    "Node-RED historical tag message inputs uses one clock sample for the default last-hour range",
    "Node-RED historical tag message inputs rejects invalid from timestamp not-a-date (string) before querying history",
    "Node-RED historical tag message inputs rejects invalid from timestamp NaN (number) before querying history",
    "Node-RED historical tag message inputs rejects invalid from timestamp Infinity (number) before querying history",
    "Node-RED historical tag message inputs rejects invalid from timestamp false (boolean) before querying history",
    "Node-RED historical tag message inputs rejects invalid from timestamp [object Object] (object) before querying history",
    "Node-RED historical tag message inputs rejects invalid from timestamp  (object) before querying history",
    "Node-RED historical tag message inputs rejects invalid to timestamp not-a-date (string) before querying history",
    "Node-RED historical tag message inputs rejects invalid to timestamp Infinity (number) before querying history",
    "Node-RED historical tag message inputs rejects a reversed range before querying history"
];
const failed = [];
const mocha = new Mocha({ timeout: 10000, reporter: 'dot' });
mocha.addFile(path.resolve('test/authorization/nodeRedHistoricalTagInputs.test.js'));
const runner = mocha.run(failures => {
    Module.prototype._compile = originalCompile;
    try {
        assert.equal(compilations, 1);
        assert.equal(failures, 21);
        assert.equal(runner.stats.tests, 29);
        assert.equal(runner.stats.passes, 8);
        assert.equal(runner.stats.pending, 0);
        assert.deepEqual(failed, expected);
        console.log('PASS: original historical inputs rejected by exactly 21 named cases; 8 compatibility passes; 1 node compiled; zero skipped.');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
});
runner.on('fail', test => failed.push(test.fullTitle()));
