const AutoRoomRepository = require("../../../application/repositories/contracts/AutoRoomRepository");
const AutoRoom = require("../../../domain/entities/AutoRoom");

function mapRoom(row) {
  if (!row) return null;
  return new AutoRoom({
    guildId: row.guild_id,
    channelId: row.channel_id,
    ownerId: row.owner_id,
    triggerChannelId: row.trigger_channel_id,
    mode: row.mode,
    userLimit: row.user_limit,
    pinHash: row.pin_hash,
    systemMarker: row.system_marker,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRenamedAt: row.last_renamed_at,
    roomNumber: row.room_number,
  });
}

class SqliteAutoRoomRepository extends AutoRoomRepository {
  constructor(database) {
    super();
    this.db = database.connection || database;
  }

  findByOwner(guildId, ownerId) {
    return mapRoom(this.db.prepare(
      "SELECT * FROM auto_rooms WHERE guild_id = ? AND owner_id = ?"
    ).get(guildId, ownerId));
  }

  findByChannel(channelId) {
    return mapRoom(this.db.prepare("SELECT * FROM auto_rooms WHERE channel_id = ?").get(channelId));
  }

  listAll() {
    return this.db.prepare("SELECT * FROM auto_rooms ORDER BY created_at, channel_id").all().map(mapRoom);
  }

  create(roomInput) {
    const room = roomInput instanceof AutoRoom ? roomInput : new AutoRoom(roomInput);
    this._insertRoom(room);
    return room;
  }

  _insertRoom(room) {
    this.db.prepare(`
      INSERT INTO auto_rooms (
        channel_id, guild_id, owner_id, trigger_channel_id, mode, user_limit,
        pin_hash, system_marker, created_at, updated_at, last_renamed_at, room_number
      ) VALUES (
        @channelId, @guildId, @ownerId, @triggerChannelId, @mode, @userLimit,
        @pinHash, @systemMarker, @createdAt, @updatedAt, @lastRenamedAt, @roomNumber
      )
    `).run(room.toJSON());
  }

  createFromReservation(roomInput, reservationId) {
    const room = roomInput instanceof AutoRoom ? roomInput : new AutoRoom(roomInput);
    if (room.roomNumber === null) {
      throw new TypeError("A numbered room is required to consume a reservation.");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const reservation = this.db.prepare(`
        SELECT guild_id, room_number, channel_id, state
        FROM auto_room_number_reservations
        WHERE reservation_id = ?
      `).get(reservationId);
      if (
        !reservation || reservation.guild_id !== room.guildId ||
        reservation.room_number !== room.roomNumber ||
        reservation.channel_id !== room.channelId ||
        reservation.state !== "channel_created"
      ) {
        throw new Error("Room number reservation does not match the room.");
      }
      this._insertRoom(room);
      const consumed = this.db.prepare(`
        DELETE FROM auto_room_number_reservations
        WHERE reservation_id = ? AND guild_id = ? AND room_number = ?
      `).run(reservationId, room.guildId, room.roomNumber).changes;
      if (consumed !== 1) throw new Error("Room number reservation was not consumed.");
      this.db.exec("COMMIT");
      return room;
    } catch (error) {
      if (this.db.inTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  update(channelId, changes) {
    const columns = {
      mode: "mode",
      userLimit: "user_limit",
      pinHash: "pin_hash",
      updatedAt: "updated_at",
      lastRenamedAt: "last_renamed_at",
    };
    const entries = Object.entries(changes).filter(([key]) => columns[key]);
    if (entries.length === 0) return this.findByChannel(channelId);

    const assignments = entries.map(([key]) => `${columns[key]} = @${key}`).join(", ");
    this.db.prepare(`UPDATE auto_rooms SET ${assignments} WHERE channel_id = @channelId`)
      .run({ channelId, ...Object.fromEntries(entries) });
    return this.findByChannel(channelId);
  }

  updateOwner(channelId, ownerId, updatedAt = Date.now()) {
    this.db.prepare(
      "UPDATE auto_rooms SET owner_id = ?, updated_at = ? WHERE channel_id = ?"
    ).run(ownerId, updatedAt, channelId);
    return this.findByChannel(channelId);
  }

  deleteByChannel(channelId) {
    return this.db.prepare("DELETE FROM auto_rooms WHERE channel_id = ?").run(channelId).changes > 0;
  }

  deleteByChannelAndResetNumbering(channelId, guildId) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const deleted = this.db.prepare(
        "DELETE FROM auto_rooms WHERE channel_id = ? AND guild_id = ?"
      ).run(channelId, guildId).changes > 0;
      let reset = false;
      if (deleted) {
        reset = this.db.prepare(`
          UPDATE guild_room_configs
          SET next_room_number = 1
          WHERE guild_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM auto_rooms WHERE guild_id = ?
            )
            AND NOT EXISTS (
              SELECT 1 FROM auto_room_number_reservations WHERE guild_id = ?
            )
        `).run(guildId, guildId, guildId).changes > 0;
      }
      this.db.exec("COMMIT");
      return { deleted, reset };
    } catch (error) {
      if (this.db.inTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listGrants(channelId) {
    return this.db.prepare(
      "SELECT channel_id AS channelId, user_id AS userId, access, expires_at AS expiresAt FROM room_grants WHERE channel_id = ? ORDER BY user_id"
    ).all(channelId);
  }

  setGrant({ channelId, userId, access, expiresAt = null }) {
    this.db.prepare(`
      INSERT INTO room_grants (channel_id, user_id, access, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id, user_id) DO UPDATE SET
        access = excluded.access,
        expires_at = excluded.expires_at
    `).run(channelId, userId, access, expiresAt);
    return { channelId, userId, access, expiresAt };
  }

  deleteGrant(channelId, userId) {
    return this.db.prepare(
      "DELETE FROM room_grants WHERE channel_id = ? AND user_id = ?"
    ).run(channelId, userId).changes > 0;
  }
}

module.exports = SqliteAutoRoomRepository;
