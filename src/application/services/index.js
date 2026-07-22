const MemberService = require("./MemberService");
const PingService = require("./ping.service");
const AutoRoomService = require("./AutoRoomService");

function createServices(container, autoRoomDependencies) {
  if (!autoRoomDependencies) {
    throw new TypeError("Auto Voice Room dependencies are required.");
  }

  return {
    memberService: new MemberService(),
    pingService: new PingService(),
    autoRoomService: new AutoRoomService({
      ...autoRoomDependencies,
      logger: autoRoomDependencies.logger || container.resolve("logger"),
    }),
  };
}

module.exports = createServices;
