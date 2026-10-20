module.exports = function(RED) {
    function FuxaGetTagDaqSettingsNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        var fuxa = RED.settings.functionGlobalContext.fuxa;

        this.on('input', async function(msg) {
            try {
                // A message override must resolve independently of the configured ID.
                var tagName = msg.tag || config.tag;
                var tagId = msg.tag ? null : config.tagId;
                if (!tagId) {
                    if (tagName) {
                        // Backward compatibility: old nodes use tag.name, need to convert to tagId
                        tagId = fuxa.getTagId(tagName, null);
                    }
                }
                
                if (tagId) {
                    var settings = await fuxa.getTagDaqSettings(tagId);
                    msg.payload = settings;
                    node.send(msg);
                } else {
                    node.error('Tag not found: ' + (tagName || config.tagId), msg);
                }
            } catch (err) {
                node.error(err, msg);
            }
        });
    }
    RED.nodes.registerType("get-tag-daq-settings", FuxaGetTagDaqSettingsNode);
}
