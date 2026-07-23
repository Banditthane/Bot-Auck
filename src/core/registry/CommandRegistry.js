class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.descriptors = new Map();
  }

  register(name, handler, metadata = {}) {
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
    this.descriptors.set(name, {
      name,
      command: handler,
      ...metadata,
    });
  }

  get(name) {
    return this.commands.get(name);
  }

  list() {
    return [...this.descriptors.values()];
  }
}

module.exports = CommandRegistry;
