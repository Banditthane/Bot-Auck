class ModerationGateway {
  async getTargetMemberFacts() {
    throw new Error("ModerationGateway.getTargetMemberFacts must be implemented.");
  }

  async getUnbanFacts() {
    throw new Error("ModerationGateway.getUnbanFacts must be implemented.");
  }

  async banMember() {
    throw new Error("ModerationGateway.banMember must be implemented.");
  }

  async kickMember() {
    throw new Error("ModerationGateway.kickMember must be implemented.");
  }

  async timeoutMember() {
    throw new Error("ModerationGateway.timeoutMember must be implemented.");
  }

  async untimeoutMember() {
    throw new Error("ModerationGateway.untimeoutMember must be implemented.");
  }

  async unbanUser() {
    throw new Error("ModerationGateway.unbanUser must be implemented.");
  }
}

module.exports = ModerationGateway;
