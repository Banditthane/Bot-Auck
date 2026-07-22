const { AUTO_NAME_ERROR_CODES: CODES, AutoNameAuthorizationError, AutoNameStateError } = require("../errors/AutoNameErrors");

function deny(message, code, details) { throw new AutoNameAuthorizationError(message, code, details); }

function assertActorAuthorized(facts) {
  if (!facts?.actorHasManageNicknames) deny("Actor lacks Manage Nicknames.", CODES.FORBIDDEN);
  return true;
}

function assertMemberEligible(facts, { actorRequired = false } = {}) {
  if (!facts) throw new AutoNameStateError("Fresh member facts are required.", CODES.INELIGIBLE);
  if (actorRequired) assertActorAuthorized(facts);
  if (facts.targetIsBot || facts.targetIsOwner) deny("Target is not eligible.", CODES.INELIGIBLE);
  if (!facts.targetHasRequiredRole) deny("Target does not have the configured role.", CODES.INELIGIBLE);
  if (!facts.botHasManageNicknames || facts.botRoleComparison <= 0 || !facts.targetManageable) {
    deny("Target cannot be managed safely.", CODES.UNMANAGEABLE);
  }
  if (actorRequired && !facts.actorIsOwner && facts.actorRoleComparison <= 0) {
    deny("Actor must have a strictly higher role than the target.", CODES.FORBIDDEN);
  }
  return true;
}

module.exports = { assertActorAuthorized, assertMemberEligible };
