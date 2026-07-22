module.exports = {
  name: "clientReady",
  //  name: "ready",
  once: true, // true หมายความว่า event นี้จะถูกเรียกแค่ครั้งเดียว

  // execute(client) {
  //   console.log(`👑 ~ ${client.user.tag}`);
  // },

  async execute({ client, container }) {
    const logger = container.resolve("logger");

    const shardId = client.shard?.ids?.[0] ?? 0;

    logger.info(`👑 ~ ${client.user.tag}`, {
      // เมื่อบอทพร้อมใช้งาน
      shardId,
    });

    const autoRoomService = container.resolve("services").autoRoomService;
    if (!autoRoomService) {
      logger.warn("Auto Voice Room reconciliation skipped: service is not registered.", { shardId });
      return;
    }

    try {
      const result = await autoRoomService.reconcile();
      logger.info("Auto Voice Room reconciliation completed.", { shardId, ...result });
    } catch (error) {
      logger.error("Auto Voice Room reconciliation failed.", {
        shardId,
        code: error?.code || "UNKNOWN",
      });
    }
  },
};
