const { AUTO_NAME_ERROR_CODES: CODES, AutoNameValidationError } = require("../errors/AutoNameErrors");

const DEFAULT_AUTO_NAME_TEMPLATE = "⦅ ¹⁾ ☠ ₍₈ ⦆ ⥊ « 𓆩{code}𓆪 »";
const ALLOWED_VARIABLES = Object.freeze(["code", "username", "displayName", "role"]);
const TOKEN = /\{([^{}]+)\}/g;
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function assertSafeText(value, label) {
  if (typeof value !== "string" || UNSAFE.test(value)) {
    throw new AutoNameValidationError(`${label} contains unsafe characters.`, CODES.TEMPLATE_INVALID);
  }
  return value.normalize("NFC");
}

class AutoNameTemplate {
  constructor(value = DEFAULT_AUTO_NAME_TEMPLATE) {
    const normalized = assertSafeText(value, "Template");
    if (normalized.length < 1 || normalized.length > 100) {
      throw new AutoNameValidationError("Template must contain 1 to 100 UTF-16 units.", CODES.TEMPLATE_INVALID);
    }
    const variables = [...normalized.matchAll(TOKEN)].map((match) => match[1]);
    if (!variables.includes("code")) {
      throw new AutoNameValidationError("Template must include {code}.", CODES.TEMPLATE_INVALID);
    }
    if (variables.some((name) => !ALLOWED_VARIABLES.includes(name))) {
      throw new AutoNameValidationError("Template contains an unsupported variable.", CODES.TEMPLATE_INVALID);
    }
    if (normalized.replace(TOKEN, "").includes("{") || normalized.replace(TOKEN, "").includes("}")) {
      throw new AutoNameValidationError("Template contains unmatched braces.", CODES.TEMPLATE_INVALID);
    }
    this.value = normalized;
    this.variables = Object.freeze([...new Set(variables)]);
    Object.freeze(this);
  }

  render(variables) {
    const rendered = this.value.replace(TOKEN, (_, name) => assertSafeText(variables?.[name], name));
    if (rendered.length < 1 || rendered.length > 32) {
      throw new AutoNameValidationError("Rendered nickname must contain 1 to 32 UTF-16 units.", CODES.RENDER_TOO_LONG);
    }
    return rendered.normalize("NFC");
  }
}

module.exports = AutoNameTemplate;
module.exports.DEFAULT_AUTO_NAME_TEMPLATE = DEFAULT_AUTO_NAME_TEMPLATE;
module.exports.ALLOWED_VARIABLES = ALLOWED_VARIABLES;
