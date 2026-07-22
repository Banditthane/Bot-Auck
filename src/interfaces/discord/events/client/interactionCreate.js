require("module-alias/register");

const { createRequestId } = require("@shared/helpers/requestId");
const LogContext = require("@logger/LogContext");

module.exports = {
  name: "interactionCreate",

  async execute({ client, container, args }) {
    const interaction = args[0];

    if (!interaction.isChatInputCommand()) return;

    const logger = container.resolve("logger");
    const router = container.resolve("interactionRouter");

    const shardId = client.shard?.ids?.[0] ?? 0;
    const requestId = createRequestId();

// สร้าง request context
    await LogContext.run(
      {
        requestId,
        shardId,
        guildId: interaction.guildId,
        userId: interaction.user?.id,
        command: interaction.commandName
      },
      async () => {
        logger.info(`Command received: ${interaction.commandName}`);
        try {
          await router.route(interaction);
        } catch (error) {
          logger.error(`Command failed: ${interaction.commandName}`);
          console.error(error);
        }
      }
    );
  }
};



// require("module-alias/register");

// const createRequestId = require("@helpers/requestId");
// const LogContext = require("@logging/LogContext");

// module.exports = {
//   name: "interactionCreate",

//   async execute({ client, args, container }) {
//     const interaction = args[0];

//     if (!interaction.isChatInputCommand()) return;

//     const logger = container.resolve("logger");
//     const router = container.resolve("interactionRouter");

//     const shardId = client.shard?.ids?.[0] ?? 0;
//     const requestId = createRequestId();

//     await LogContext.run(
//       {
//         requestId,
//         shardId,
//         guildId: interaction.guildId,
//         userId: interaction.user?.id,
//         command: interaction.commandName,
//       },
//       async () => {
//         logger.info(`Command received: ${interaction.commandName}`);

//         try {
//           await router.route(interaction);
//         } catch (error) {
//           logger.error(`Command failed: ${interaction.commandName}`);
//           console.error(error);
//         }
//       }
//     );
//   },
// };





// require("module-alias/register");

// const createRequestId = require("@helpers/requestId");
// const LogContext = require("@logging/LogContext");

// module.exports = {
//   name: "interactionCreate",

//   async execute(client, interaction, container) {

//     if (!interaction.isChatInputCommand()) return;

//     const logger = container.resolve("logger");
//     const router = container.resolve("interactionRouter");

//     const shardId = interaction.client.shard?.ids?.[0] ?? 0;
//     const requestId = createRequestId();

// // สร้าง request context


//     logger.info(
//       `Command received: ${interaction.commandName}`,
//       { shardId, requestId }
//     );

//     try {
//       await router.route(interaction, {
//         shardId,
//         requestId
//       });
//     } catch (error) {
//       logger.error(
//         `Command failed: ${interaction.commandName}`,
//         { shardId, requestId }
//       );

//       console.error(error);

//     }
//   }
// };





