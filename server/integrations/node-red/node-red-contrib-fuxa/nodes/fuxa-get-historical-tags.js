module.exports = function(RED) {
    function hasValue(value) {
        return value !== undefined && value !== null &&
            !(typeof value === 'string' && value.trim() === '');
    }

    function timestamp(messageValue, configuredValue, fallback, name) {
        var value = hasValue(messageValue) ? messageValue :
            (hasValue(configuredValue) ? configuredValue : fallback);
        if (typeof value === 'string') {
            value = value.trim();
            value = /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : Date.parse(value);
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new Error('Invalid ' + name + ' timestamp: use milliseconds or a valid date string');
        }
        return value;
    }

    function FuxaGetHistoricalTagsNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        var fuxa = this.context().global.get('fuxa');

        this.on('input', async function(msg) {
            try {
                var tags = hasValue(msg.tags) ? msg.tags : config.tags;
                
                // Handle new JSON format
                if (typeof tags === 'string' && tags.startsWith('[')) {
                    try {
                        tags = JSON.parse(tags);
                    } catch(e) {
                        // Fallback to old comma-separated format
                        tags = tags.split(',').map(tag => tag.trim());
                    }
                } else if (typeof tags === 'string') {
                    // Old comma-separated format
                    tags = tags.split(',').map(tag => tag.trim());
                }
                
                var now = Date.now();
                var fromts = timestamp(msg.from, config.from, now - 3600000, 'from');
                var tots = timestamp(msg.to, config.to, now, 'to');
                if (fromts > tots) {
                    throw new Error('Invalid historical range: from timestamp must not exceed to timestamp');
                }

                // Convert tag names to tag IDs (like advanced reports do)
                var tagIds = [];
                var resolvedTags = [];
                for (var i = 0; i < tags.length; i++) {
                    var tagId = fuxa.getTagId(tags[i]);
                    if (tagId) {
                        tagIds.push(tagId);
                        resolvedTags.push({ id: tagId, name: tags[i] });
                    } else {
                        node.warn('Tag not found: ' + tags[i]);
                    }
                }

                if (tagIds.length > 0) {
                    var data = await fuxa.getHistoricalTags(tagIds, fromts, tots);
                    
                    // Filter out null values and convert to the expected format (like advanced reports)
                    var filteredData = {};
                    for (var resolvedTag of resolvedTags) {
                        if (Object.prototype.hasOwnProperty.call(data, resolvedTag.id)) {
                            var tagData = data[resolvedTag.id].filter(function(item) {
                                return item && item.x !== undefined && item.y !== undefined && item.y !== null;
                            });
                            // Keep the name paired with its ID even when other lookups fail.
                            // Define an own key so names such as "__proto__" remain data.
                            Object.defineProperty(filteredData, resolvedTag.name, {
                                value: tagData, enumerable: true, writable: true, configurable: true
                            });
                        }
                    }
                    
                    msg.payload = filteredData;
                    msg.topic = resolvedTags[0].name;  // First resolved tag for join operations
                    node.send(msg);
                } else {
                    node.error('No valid tags found', msg);
                }
            } catch (err) {
                node.error(err, msg);
            }
        });
    }
    RED.nodes.registerType("get-historical-tags", FuxaGetHistoricalTagsNode);
}
