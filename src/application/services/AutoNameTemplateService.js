const AutoNameTemplate = require("../../domain/valueObjects/AutoNameTemplate");
const MemberNumber = require("../../domain/valueObjects/MemberNumber");

class AutoNameTemplateService {
  validate(template) { return new AutoNameTemplate(template); }

  render({ template, memberNumber, codeLength = 6, username, displayName, role }) {
    const number = memberNumber instanceof MemberNumber ? memberNumber : new MemberNumber(memberNumber);
    return new AutoNameTemplate(template).render({
      code: number.format(codeLength), username, displayName, role,
    });
  }

  preview({ template, codeLength = 6, memberNumber = 1, username = "username", displayName = "Display Name", role = "Role" }) {
    return this.render({ template, codeLength, memberNumber, username, displayName, role });
  }
}
module.exports = AutoNameTemplateService;
