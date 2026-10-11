module.exports = function(RED) {
    function FuxaGetHistoricalTagsNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        var fuxa = this.context().global.get('fuxa');

        this.on('input', async function(msg) {
            try {
                var tags = config.tags || msg.tags;
                
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
                
                var fromts = config.from || msg.from || Date.now() - 3600000; // default 1 hour ago
                var tots = config.to || msg.to || Date.now();

                // Convert string timestamps to numbers if needed
                if (typeof fromts === 'string') {
                    fromts = new Date(fromts).getTime();
                }
                if (typeof tots === 'string') {
                    tots = new Date(tots).getTime();
                }

                // Convert tag names to tag IDs (like advanced reports do)
                var tagIds = [];
                var resolvedTagNames = [];
                for (var i = 0; i < tags.length; i++) {
                    var tagId = fuxa.getTagId(tags[i]);
                    if (tagId) {
                        tagIds.push(tagId);
                        resolvedTagNames.push(tags[i]);
                    } else {
                        node.warn('Tag not found: ' + tags[i]);
                    }
                }

                if (tagIds.length > 0) {
                    var data = await fuxa.getHistoricalTags(tagIds, fromts, tots);
                    
                    // Filter out null values and convert to the expected format (like advanced reports)
                    var filteredData = {};
                    for (var tagId in data) {
                        if (data.hasOwnProperty(tagId)) {
                            var tagData = data[tagId].filter(function(item) {
                                return item && item.x !== undefined && item.y !== undefined && item.y !== null;
                            });
                            // Convert back to tag name keys for consistency
                            var tagName = resolvedTagNames[tagIds.indexOf(tagId)];
                            if (tagName) {
                                filteredData[tagName] = tagData;
                            }
                        }
                    }
                    
                    msg.payload = filteredData;
                    msg.topic = resolvedTagNames[0];  // Set topic to first resolved tag for join operations
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
