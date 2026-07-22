class Container {
  constructor() {
    this.services = new Map();
  }

  register(name, instance) {
    if (this.services.has(name)) {
      throw new Error(`Dependency  "${name}" already registered.`);
    }
    this.services.set(name, instance);
  }

  resolve(name) {
    if (!this.services.has(name)) {
      throw new Error(`Dependency "${name}" not found.`);
    }
    return this.services.get(name);
  }
}

module.exports = Container;
