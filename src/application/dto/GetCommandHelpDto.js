class GetCommandHelpDto {
  constructor(input = {}) {
    if (typeof input.userId !== "string" || !/^\d{17,20}$/.test(input.userId)) throw new TypeError("userId is invalid.");
    if (input.guildId != null && (typeof input.guildId !== "string" || !/^\d{17,20}$/.test(input.guildId))) throw new TypeError("guildId is invalid.");
    this.guildId = input.guildId || null; this.userId = input.userId; this.commandName = input.commandName ? String(input.commandName).toLowerCase().slice(0, 32) : null;
    this.category = input.category ? String(input.category).slice(0, 64) : null; this.permissionBits = String(input.permissionBits || "0"); this.isOwner = Boolean(input.isOwner); Object.freeze(this);
  }
}
module.exports = GetCommandHelpDto;
