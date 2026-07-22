const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

class LogContext {

  /**
   * Run function within a context
   */
  static run(context, callback) {
    return storage.run(context, callback);
  }

  /**
   * Get full context store
   */
  static getStore() {
    return storage.getStore();
  }

  /**
   * Get value by key
   */
  static get(key) {
    const store = storage.getStore();
    return store ? store[key] : undefined;
  }

  /**
   * Set value inside current context
   */
  static set(key, value) {
    const store = storage.getStore();
    if (store) {
      store[key] = value;
    }
  }

  /**
   * Get requestId
   */
  static getRequestId() {
    const store = storage.getStore();
    return store?.requestId || "-";
  }

}

module.exports = LogContext;