const CommandCatalog = require("../../application/repositories/contracts/CommandCatalog");
const CommandHelpEntry = require("../../domain/entities/CommandHelpEntry");
class RegistryCommandCatalog extends CommandCatalog {
  constructor(source) { super(); this.source = source; }
  async list() { const descriptors = typeof this.source.list === "function" ? this.source.list() : this.source; return [...descriptors].map((descriptor) => { const command = descriptor.command || descriptor; const json = command.data?.toJSON?.() || descriptor.commandJson || {}; return new CommandHelpEntry({ ...descriptor, name: descriptor.name || json.name, description: json.description, guildOnly: descriptor.guildOnly ?? json.dm_permission === false, defaultMemberPermissions: descriptor.defaultMemberPermissions ?? json.default_member_permissions, visible: descriptor.help?.visible ?? descriptor.visible, order: descriptor.help?.order ?? descriptor.order, commandJson: json }); }).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)); }
  async findByName(name) { return (await this.list()).find((entry) => entry.name === name) || null; }
}
module.exports = RegistryCommandCatalog;
