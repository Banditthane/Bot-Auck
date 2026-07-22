const fs = require("fs");
const path = require("path");

function load(client, container) {
  const logger = container.resolve("logger");

  const basePath = path.resolve(
    __dirname,
    "../../interfaces/discord/events"
  );

  function walk(dir) {
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        walk(full);
        continue;
      }

      if (!file.endsWith(".js")) continue;
      const event = require(full);

      if (!event.name || typeof event.execute !== "function") {
        logger.warn(`Invalid event: ${file}`);
        continue;
      }

      const handler = (...args) =>
        event.execute({
          client,
          container,
          args,
        });

      if (event.once) {
        client.once(event.name, handler);
      } else {
        client.on(event.name, handler);
      }
      logger.debug(`Loaded event: ${event.name} from ${file}`);
    }
  }
  walk(basePath);
}

module.exports = { load };
