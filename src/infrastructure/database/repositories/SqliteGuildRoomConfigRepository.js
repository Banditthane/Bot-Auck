const GuildRoomConfigRepository = require("../../../application/repositories/contracts/GuildRoomConfigRepository");

function mapConfig(row) {
  if (!row) return null;
  return {
    guildId: row.guild_id,
    triggerChannelId: row.trigger_channel_id,
    categoryId: row.category_id,
    logChannelId: row.log_channel_id,
    moderatorRoleId: row.moderator_role_id,
    defaultNameTemplate: row.default_name_template,
    defaultUserLimit: row.default_user_limit,
    emptyDeleteDelaySeconds: row.empty_delete_delay_seconds,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextRoomNumber: row.next_room_number,
  };
}

class SqliteGuildRoomConfigRepository extends GuildRoomConfigRepository {
  constructor(database) {
    super();
    this.db = database.connection || database;
  }

  findByGuild(guildId) {
    return mapConfig(this.db.prepare("SELECT * FROM guild_room_configs WHERE guild_id = ?").get(guildId));
  }

  listAll() {
    return this.db.prepare("SELECT * FROM guild_room_configs ORDER BY guild_id").all().map(mapConfig);
  }

  upsert(input) {
    const now = input.updatedAt || Date.now();
    const existing = this.findByGuild(input.guildId);
    const config = {
      guildId: input.guildId,
      triggerChannelId: input.triggerChannelId,
      categoryId: input.categoryId,
      logChannelId: input.logChannelId || null,
      moderatorRoleId: input.moderatorRoleId || null,
      defaultNameTemplate: input.defaultNameTemplate || "{displayName}'s room",
      defaultUserLimit: input.defaultUserLimit ?? 0,
      emptyDeleteDelaySeconds: input.emptyDeleteDelaySeconds ?? 5,
      enabled: input.enabled === false ? 0 : 1,
      createdAt: existing?.createdAt || input.createdAt || now,
      updatedAt: now,
      nextRoomNumber: existing?.nextRoomNumber ?? 1,
    };

    this.db.prepare(`
      INSERT INTO guild_room_configs (
        guild_id, trigger_channel_id, category_id, log_channel_id, moderator_role_id,
        default_name_template, default_user_limit, empty_delete_delay_seconds,
        enabled, created_at, updated_at, next_room_number
      ) VALUES (
        @guildId, @triggerChannelId, @categoryId, @logChannelId, @moderatorRoleId,
        @defaultNameTemplate, @defaultUserLimit, @emptyDeleteDelaySeconds,
        @enabled, @createdAt, @updatedAt, @nextRoomNumber
      ) ON CONFLICT(guild_id) DO UPDATE SET
        trigger_channel_id = excluded.trigger_channel_id,
        category_id = excluded.category_id,
        log_channel_id = excluded.log_channel_id,
        moderator_role_id = excluded.moderator_role_id,
        default_name_template = excluded.default_name_template,
        default_user_limit = excluded.default_user_limit,
        empty_delete_delay_seconds = excluded.empty_delete_delay_seconds,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(config);
    return this.findByGuild(input.guildId);
  }

  reserveNextRoomNumber(guildId, reservationId, updatedAt = Date.now()) {
    if (typeof reservationId !== "string" || !reservationId) {
      throw new TypeError("reservationId must be a non-empty string.");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const allocated = this.db.prepare(`
        UPDATE guild_room_configs
        SET next_room_number = MAX(
              next_room_number,
              COALESCE((
                SELECT MAX(room_number) + 1 FROM auto_rooms
                WHERE guild_id = ? AND room_number IS NOT NULL
              ), 1),
              COALESCE((
                SELECT MAX(room_number) + 1 FROM auto_room_number_reservations
                WHERE guild_id = ?
              ), 1)
            ) + 1,
            updated_at = ?
        WHERE guild_id = ?
        RETURNING next_room_number - 1 AS room_number
      `).get(guildId, guildId, updatedAt, guildId);
      if (!allocated) throw new Error(`Guild room config not found for ${guildId}.`);
      this.db.prepare(`
        INSERT INTO auto_room_number_reservations (
          reservation_id, guild_id, room_number, created_at, channel_id, state, updated_at
        ) VALUES (?, ?, ?, ?, NULL, 'reserved', ?)
      `).run(reservationId, guildId, allocated.room_number, updatedAt, updatedAt);
      this.db.exec("COMMIT");
      return allocated.room_number;
    } catch (error) {
      if (this.db.inTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markNumberReservationChannel(guildId, reservationId, channelId, state = "channel_created", updatedAt = Date.now()) {
    if (!channelId || !["channel_created", "orphaned"].includes(state)) {
      throw new TypeError("A channelId and channel-bound reservation state are required.");
    }
    const changed = this.db.prepare(`
      UPDATE auto_room_number_reservations
      SET channel_id = ?, state = ?, updated_at = ?
      WHERE guild_id = ? AND reservation_id = ?
    `).run(channelId, state, updatedAt, guildId, reservationId).changes;
    if (changed !== 1) throw new Error("Room number reservation was not found.");
    return true;
  }

  listNumberReservations(guildId) {
    return this.db.prepare(`
      SELECT reservation_id AS reservationId, guild_id AS guildId,
             room_number AS roomNumber, created_at AS createdAt,
             channel_id AS channelId, state, updated_at AS updatedAt
      FROM auto_room_number_reservations
      WHERE guild_id = ? ORDER BY room_number
    `).all(guildId);
  }

  claimOrphanedNumberReservation(guildId, reservationId, updatedAt = Date.now()) {
    return this.db.prepare(`
      UPDATE auto_room_number_reservations
      SET state = 'cleaning', updated_at = ?
      WHERE guild_id = ? AND reservation_id = ? AND state = 'orphaned'
    `).run(updatedAt, guildId, reservationId).changes === 1;
  }

  releaseNumberReservation(guildId, reservationId) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const released = this.db.prepare(`
        DELETE FROM auto_room_number_reservations
        WHERE guild_id = ? AND reservation_id = ?
      `).run(guildId, reservationId).changes > 0;
      let reset = false;
      if (released) {
        reset = this.db.prepare(`
          UPDATE guild_room_configs
          SET next_room_number = 1
          WHERE guild_id = ?
            AND NOT EXISTS (SELECT 1 FROM auto_rooms WHERE guild_id = ?)
            AND NOT EXISTS (
              SELECT 1 FROM auto_room_number_reservations WHERE guild_id = ?
            )
        `).run(guildId, guildId, guildId).changes > 0;
      }
      this.db.exec("COMMIT");
      return { released, reset };
    } catch (error) {
      if (this.db.inTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  resetNumberingIfNoManagedRooms(guildId, updatedAt = Date.now()) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const hasManagedRooms = Boolean(this.db.prepare(
        "SELECT 1 FROM auto_rooms WHERE guild_id = ? LIMIT 1"
      ).get(guildId));
      const hasReservations = Boolean(this.db.prepare(
        "SELECT 1 FROM auto_room_number_reservations WHERE guild_id = ? LIMIT 1"
      ).get(guildId));
      let reset = false;
      if (hasManagedRooms || hasReservations) {
        this.db.prepare(`
          UPDATE guild_room_configs
          SET next_room_number = MAX(
                next_room_number,
                COALESCE((
                  SELECT MAX(room_number) + 1
                  FROM auto_rooms
                  WHERE guild_id = ? AND room_number IS NOT NULL
                ), 1),
                COALESCE((
                  SELECT MAX(room_number) + 1
                  FROM auto_room_number_reservations
                  WHERE guild_id = ?
                ), 1)
              ),
              updated_at = ?
          WHERE guild_id = ?
        `).run(guildId, guildId, updatedAt, guildId);
      } else {
        reset = this.db.prepare(`
          UPDATE guild_room_configs
          SET next_room_number = 1, updated_at = ?
          WHERE guild_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM auto_rooms WHERE guild_id = ?
            )
            AND NOT EXISTS (
              SELECT 1 FROM auto_room_number_reservations WHERE guild_id = ?
            )
        `).run(updatedAt, guildId, guildId, guildId).changes > 0;
      }
      this.db.exec("COMMIT");
      return reset;
    } catch (error) {
      if (this.db.inTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  disable(guildId, updatedAt = Date.now()) {
    this.db.prepare(
      "UPDATE guild_room_configs SET enabled = 0, updated_at = ? WHERE guild_id = ?"
    ).run(updatedAt, guildId);
    return this.findByGuild(guildId);
  }
}

module.exports = SqliteGuildRoomConfigRepository;
