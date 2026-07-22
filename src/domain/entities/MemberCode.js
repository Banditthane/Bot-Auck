const MemberNumber = require("../valueObjects/MemberNumber");

class MemberCode {
  constructor({ guildId, userId, memberNumber, createdAt, updatedAt }) {
    if (!guildId || !userId) throw new TypeError("guildId and userId are required.");
    this.guildId = guildId;
    this.userId = userId;
    this.memberNumber = memberNumber instanceof MemberNumber ? memberNumber : new MemberNumber(memberNumber);
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    Object.freeze(this);
  }

  display(codeLength) { return this.memberNumber.format(codeLength); }
}
module.exports = MemberCode;
