'use strict';

const registerHistoricalTagsNode = require('../../integrations/node-red/node-red-contrib-fuxa/nodes/fuxa-get-historical-tags');
const assert = require('node:assert/strict');

describe('Node-RED historical tags node', () => {
    let NodeConstructor;
    let inputHandler;
    let sentMessages;
    let warnings;
    let errors;
    let requestedTagIds;

    beforeEach(() => {
        inputHandler = null;
        sentMessages = [];
        warnings = [];
        errors = [];
        requestedTagIds = [];

        const fuxa = {
            getTagId(name) {
                return {
                    Pressure: 'tag-pressure',
                    Flow: 'tag-flow',
                }[name] || null;
            },
            async getHistoricalTags(tagIds) {
                requestedTagIds = tagIds;
                return {
                    'tag-pressure': [
                        { x: 1, y: 12.5 },
                        { x: 2, y: null },
                    ],
                    'tag-flow': [{ x: 1, y: 7 }],
                };
            },
        };

        const RED = {
            nodes: {
                createNode(node) {
                    node.context = () => ({
                        global: {
                            get: key => key === 'fuxa' ? fuxa : undefined,
                        },
                    });
                    node.on = (event, handler) => {
                        if (event === 'input') inputHandler = handler;
                    };
                    node.send = msg => sentMessages.push(msg);
                    node.warn = warning => warnings.push(warning);
                    node.error = (error, msg) => errors.push({ error, msg });
                },
                registerType(name, constructor) {
                    if (name === 'get-historical-tags') NodeConstructor = constructor;
                },
            },
        };

        registerHistoricalTagsNode(RED);
    });

    it('keeps history keyed by the resolved tag when an earlier requested tag is missing', async () => {
        new NodeConstructor({ tags: ['Missing', 'Pressure', 'Flow'] });
        const msg = {};

        await inputHandler(msg);

        assert.deepEqual(requestedTagIds, ['tag-pressure', 'tag-flow']);
        assert.deepEqual(warnings, ['Tag not found: Missing']);
        assert.deepEqual(errors, []);
        assert.equal(sentMessages.length, 1);
        assert.deepEqual(sentMessages[0].payload, {
            Pressure: [{ x: 1, y: 12.5 }],
            Flow: [{ x: 1, y: 7 }],
        });
        assert.equal(Object.prototype.hasOwnProperty.call(sentMessages[0].payload, 'Missing'), false);
        assert.equal(sentMessages[0].topic, 'Pressure');
    });
});
