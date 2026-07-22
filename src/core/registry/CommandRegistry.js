class CommandRegistry {
  constructor() {
    this.commands = new Map();
  }

  register(name, handler) {
    if (typeof name !== "string" || name.trim() !== name || name.length === 0) {
      throw new TypeError("Command name must be a non-empty trimmed string.");
    }

    if (!handler || typeof handler.execute !== "function") {
      throw new TypeError(`Command "${name}" must provide an execute function.`);
    }

    if (this.commands.has(name)) {
      throw new Error(`Command "${name}" is already registered.`);
    }

    this.commands.set(name, handler);
  }

  get(name) {
    return this.commands.get(name);
  }
}

module.exports = CommandRegistry;
