const COMMAND_HELP_ERROR_CODES = Object.freeze({ VALIDATION: "COMMAND_HELP_VALIDATION", NOT_FOUND: "COMMAND_HELP_NOT_FOUND", FORBIDDEN: "COMMAND_HELP_FORBIDDEN", SESSION_EXPIRED: "COMMAND_HELP_SESSION_EXPIRED" });
class CommandHelpError extends Error { constructor(message, code) { super(message); this.name = this.constructor.name; this.code = code; } }
module.exports = { COMMAND_HELP_ERROR_CODES, CommandHelpError };
