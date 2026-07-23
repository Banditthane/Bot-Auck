const AutoRoleRule = require("../../../domain/entities/AutoRoleRule");

class SqliteAutoRoleRuleRepository {
  constructor(database) {
    this.db = database.connection;
  }

  async create(rule) {
    this.db.prepare(`
      INSERT INTO auto_role_rules (
        rule_id, guild_id, name, enabled, trigger, required_role_ids, excluded_role_ids, target_role_ids,
        remove_role_ids, priority, exclusive_group, conflict_policy, stop_on_match, created_by, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...params(rule));
    return rule;
  }

  async update(rule) {
    this.db.prepare(`
      UPDATE auto_role_rules SET name=?, enabled=?, trigger=?, required_role_ids=?, excluded_role_ids=?,
        target_role_ids=?, remove_role_ids=?, priority=?, exclusive_group=?, conflict_policy=?,
        stop_on_match=?, updated_at=?, deleted_at=? WHERE guild_id=? AND rule_id=?
    `).run(rule.name, bool(rule.enabled), rule.trigger, json(rule.requiredRoleIds), json(rule.excludedRoleIds),
      json(rule.targetRoleIds), json(rule.removeRoleIds), rule.priority, rule.exclusiveGroup, rule.conflictPolicy,
      bool(rule.stopOnMatch), rule.updatedAt, rule.deletedAt, rule.guildId, rule.ruleId);
    return rule;
  }

  async findById(guildId, ruleId) {
    const row = this.db.prepare("SELECT * FROM auto_role_rules WHERE guild_id = ? AND rule_id = ? AND deleted_at IS NULL").get(guildId, ruleId);
    return row && map(row);
  }

  async listByGuildTrigger(guildId, trigger) {
    return this.db.prepare("SELECT * FROM auto_role_rules WHERE guild_id = ? AND trigger = ? AND deleted_at IS NULL ORDER BY priority DESC, rule_id ASC")
      .all(guildId, trigger).map(map);
  }

  async listByGuild(guildId) {
    return this.db.prepare("SELECT * FROM auto_role_rules WHERE guild_id = ? AND deleted_at IS NULL ORDER BY priority DESC, rule_id ASC")
      .all(guildId).map(map);
  }

  async softDelete(guildId, ruleId, deletedAt = Date.now()) {
    this.db.prepare("UPDATE auto_role_rules SET deleted_at = ?, updated_at = ? WHERE guild_id = ? AND rule_id = ?")
      .run(deletedAt, deletedAt, guildId, ruleId);
  }
}

function json(value) { return JSON.stringify(value || []); }
function bool(value) { return value ? 1 : 0; }
function params(rule) {
  return [rule.ruleId, rule.guildId, rule.name, bool(rule.enabled), rule.trigger, json(rule.requiredRoleIds),
    json(rule.excludedRoleIds), json(rule.targetRoleIds), json(rule.removeRoleIds), rule.priority, rule.exclusiveGroup,
    rule.conflictPolicy, bool(rule.stopOnMatch), rule.createdBy, rule.createdAt ?? Date.now(), rule.updatedAt ?? Date.now(), rule.deletedAt];
}
function map(row) {
  return new AutoRoleRule({
    ruleId: row.rule_id, guildId: row.guild_id, name: row.name, enabled: Boolean(row.enabled), trigger: row.trigger,
    requiredRoleIds: JSON.parse(row.required_role_ids), excludedRoleIds: JSON.parse(row.excluded_role_ids),
    targetRoleIds: JSON.parse(row.target_role_ids), removeRoleIds: JSON.parse(row.remove_role_ids),
    priority: row.priority, exclusiveGroup: row.exclusive_group, conflictPolicy: row.conflict_policy,
    stopOnMatch: Boolean(row.stop_on_match), createdBy: row.created_by, createdAt: row.created_at,
    updatedAt: row.updated_at, deletedAt: row.deleted_at,
  });
}

module.exports = SqliteAutoRoleRuleRepository;
