const GetCommandHelpDto = require("../dto/GetCommandHelpDto");
const { filterVisible } = require("../../domain/policies/CommandVisibilityPolicy");
const { COMMAND_HELP_ERROR_CODES: CODES, CommandHelpError } = require("../../domain/errors/CommandHelpErrors");
class CommandHelpService {
  constructor({ commandCatalog }) { if (!commandCatalog) throw new TypeError("commandCatalog is required."); this.catalog = commandCatalog; }
  async get(input) { const dto = input instanceof GetCommandHelpDto ? input : new GetCommandHelpDto(input); const visible = filterVisible(await this.catalog.list(), dto); if (dto.commandName) { const entry = visible.find((item) => item.name === dto.commandName); if (!entry) throw new CommandHelpError("Command help was not found.", CODES.NOT_FOUND); return { ok: true, view: "detail", entry }; } const entries = dto.category ? visible.filter((item) => item.category === dto.category) : visible; return { ok: true, view: dto.category ? "category" : "home", entries, categories: [...new Set(visible.map((item) => item.category))].sort() }; }
}
module.exports = CommandHelpService;
