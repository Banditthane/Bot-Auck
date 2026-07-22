function isVisible(entry, facts = {}) {
  if (!entry?.visible || entry.availability === "HIDDEN") return false;
  if (!entry.defaultMemberPermissions) return true;
  const required = BigInt(entry.defaultMemberPermissions); const effective = BigInt(facts.permissionBits || 0);
  return facts.isOwner === true || (effective & required) === required;
}
function filterVisible(entries, facts) { return entries.filter((entry) => isVisible(entry, facts)); }
module.exports = { isVisible, filterVisible };
