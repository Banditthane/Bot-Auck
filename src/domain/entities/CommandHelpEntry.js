class CommandHelpEntry {
  constructor(input = {}) {
    if (!input.name || !input.description) throw new TypeError("Command help name and description are required.");
    this.name = String(input.name); this.description = String(input.description);
    this.category = String(input.category || "Utility"); this.guildOnly = Boolean(input.guildOnly);
    this.defaultMemberPermissions = input.defaultMemberPermissions == null ? null : String(input.defaultMemberPermissions);
    this.requiredBotPermissions = Object.freeze([...(input.requiredBotPermissions || [])].map(String));
    this.usage = Object.freeze([...(input.usage || [])].map(String)); this.examples = Object.freeze([...(input.examples || [])].map(String));
    this.relatedCommands = Object.freeze([...(input.relatedCommands || [])].map(String));
    this.availability = String(input.availability || "AVAILABLE"); this.visible = input.visible !== false;
    this.order = Number.isInteger(input.order) ? input.order : 0; this.commandJson = input.commandJson || null;
    Object.freeze(this);
  }
}
module.exports = CommandHelpEntry;
