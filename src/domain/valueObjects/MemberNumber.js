const { AUTO_NAME_ERROR_CODES: CODES, AutoNameValidationError } = require("../errors/AutoNameErrors");

const MIN_CODE_LENGTH = 1;
const MAX_CODE_LENGTH = 12;

class MemberNumber {
  constructor(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new AutoNameValidationError("Member number must be a positive safe integer.", CODES.VALIDATION);
    }
    this.value = value;
    Object.freeze(this);
  }

  format(codeLength = 6) {
    MemberNumber.assertCodeLength(codeLength);
    const maximum = (10 ** codeLength) - 1;
    if (this.value > maximum) {
      throw new AutoNameValidationError("Member number does not fit the configured code length.", CODES.CODE_EXHAUSTED);
    }
    return String(this.value).padStart(codeLength, "0");
  }

  static assertCodeLength(value) {
    if (!Number.isInteger(value) || value < MIN_CODE_LENGTH || value > MAX_CODE_LENGTH) {
      throw new AutoNameValidationError("Code length must be an integer from 1 to 12.", CODES.VALIDATION);
    }
    return value;
  }
}

module.exports = MemberNumber;
module.exports.MIN_CODE_LENGTH = MIN_CODE_LENGTH;
module.exports.MAX_CODE_LENGTH = MAX_CODE_LENGTH;
