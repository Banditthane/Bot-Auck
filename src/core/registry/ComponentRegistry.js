class ComponentRegistry {
  constructor() {
    this.components = [];
  }

  register(component) {
    if (!component || typeof component.execute !== "function") {
      throw new TypeError("Component handler must provide execute().");
    }
    this.components.push(component);
  }

  async route(interaction, container) {
    for (const component of this.components) {
      if (await component.execute({ interaction, container })) return true;
    }
    return false;
  }
}

module.exports = ComponentRegistry;
