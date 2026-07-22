const AutoRoom = require("../../domain/entities/AutoRoom");
const crypto = require("node:crypto");
const {
  RoomAuthorizationError,
  RoomConflictError,
  RoomNotFoundError,
  RoomValidationError,
} = require("../../domain/errors/RoomErrors");
const { assertMode, mayManageRoom } = require("../../domain/policies/RoomPermissionPolicy");

const DEFAULT_DELETE_DELAY_SECONDS = 5;
const DEFAULT_RENAME_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_CREATE_COOLDOWN_MS = 5 * 1000;
const DEFAULT_RESERVATION_LEASE_MS = 5 * 60 * 1000;

class KeyedMutex {
  constructor() {
    this.tails = new Map();
  }

  async run(key, work) {
    const previous = this.tails.get(key) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.catch(() => {}).then(() => gate);
    this.tails.set(key, tail);
    await previous.catch(() => {});
    try {
      return await work();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

function sanitizeRoomName(value) {
  if (typeof value !== "string") {
    throw new RoomValidationError("Room name must be a string.");
  }
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/@/g, "@​")
    .replace(/\s+/g, " ")
    .trim();
  if (!sanitized || [...sanitized].length > 100) {
    throw new RoomValidationError("Room name must contain 1 to 100 visible characters.");
  }
  return sanitized;
}

function renderRoomName(template, displayName, number = null) {
  if (typeof template !== "string") {
    throw new RoomValidationError("Room name template must be a string.");
  }
  if (template.includes("{number}") && (!Number.isInteger(number) || number < 1)) {
    throw new RoomValidationError("A positive room number is required by this template.");
  }
  const safeDisplayName = typeof displayName === "string" && displayName.trim()
    ? displayName.trim()
    : "Member";
  return sanitizeRoomName(
    template
      .replaceAll("{displayName}", safeDisplayName)
      .replaceAll("{number}", number === null ? "{number}" : String(number))
  );
}

function assertLimit(value) {
  if (!Number.isInteger(value) || value < 0 || value > 99) {
    throw new RoomValidationError("Room limit must be an integer from 0 to 99.");
  }
}

class AutoRoomService {
  constructor({
    roomRepository,
    configRepository,
    roomGateway,
    logger,
    clock = { now: () => Date.now() },
    scheduler = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id) },
    renameCooldownMs = DEFAULT_RENAME_COOLDOWN_MS,
    createCooldownMs = DEFAULT_CREATE_COOLDOWN_MS,
    reservationLeaseMs = DEFAULT_RESERVATION_LEASE_MS,
    reservationIdFactory = () => crypto.randomUUID(),
  }) {
    if (!roomRepository || !configRepository || !roomGateway) {
      throw new TypeError("AutoRoomService requires roomRepository, configRepository, and roomGateway.");
    }
    this.rooms = roomRepository;
    this.configs = configRepository;
    this.gateway = roomGateway;
    this.logger = logger || { info() {}, warn() {}, error() {} };
    this.clock = clock;
    this.scheduler = scheduler;
    this.renameCooldownMs = renameCooldownMs;
    this.createCooldownMs = createCooldownMs;
    this.reservationLeaseMs = reservationLeaseMs;
    this.reservationIdFactory = reservationIdFactory;
    this.locks = new KeyedMutex();
    this.deleteTimers = new Map();
    this.lastCreateAtByOwner = new Map();
  }

  getGuildConfig(guildId) {
    return this.configs.findByGuild(guildId);
  }

  getManagedRoom(channelId) {
    return this.rooms.findByChannel(channelId);
  }

  async configureGuild(input) {
    if (!input?.guildId || !input.triggerChannelId || !input.categoryId) {
      throw new RoomValidationError("guildId, triggerChannelId, and categoryId are required.");
    }
    assertLimit(input.defaultUserLimit ?? 0);
    const delay = input.emptyDeleteDelaySeconds ?? DEFAULT_DELETE_DELAY_SECONDS;
    if (!Number.isInteger(delay) || delay < 0 || delay > 300) {
      throw new RoomValidationError("Empty delete delay must be an integer from 0 to 300 seconds.");
    }
    const valid = await this.gateway.validateConfig(input);
    if (!valid) throw new RoomValidationError("Trigger/category configuration is invalid for this guild.");
    return this.configs.upsert({ ...input, emptyDeleteDelaySeconds: delay });
  }

  async handleVoiceStateChange({ guildId, userId, displayName, bot = false, oldChannelId, newChannelId }) {
    if (bot || !guildId || !userId || oldChannelId === newChannelId) return null;
    const config = this.configs.findByGuild(guildId);
    let result = null;

    if (config?.enabled && newChannelId === config.triggerChannelId) {
      result = await this.createOrMoveToOwnedRoom({ guildId, userId, displayName, config });
    }
    if (oldChannelId) {
      await this.handleVoiceDeparture({ guildId, channelId: oldChannelId, userId });
    }
    return result;
  }

  async createOrMoveToOwnedRoom({ guildId, userId, displayName, config: suppliedConfig }) {
    return this.locks.run(`create:${guildId}:${userId}`, async () => {
      const config = suppliedConfig || this.configs.findByGuild(guildId);
      if (!config?.enabled) throw new RoomValidationError("Auto Voice Room is not configured or is disabled.");

      const existing = this.rooms.findByOwner(guildId, userId);
      let replacingStaleRecord = false;
      if (existing) {
        const snapshot = await this.gateway.getChannelSnapshot({ guildId, channelId: existing.channelId });
        if (
          snapshot?.isVoice && snapshot.guildId === guildId && snapshot.managedMarker === true
        ) {
          await this.gateway.moveMember({ guildId, userId, channelId: existing.channelId });
          return {
            created: false,
            channelId: existing.channelId,
            roomNumber: existing.roomNumber,
          };
        }
        this.rooms.deleteByChannelAndResetNumbering(existing.channelId, guildId);
        replacingStaleRecord = true;
      }

      const now = this.clock.now();
      const createKey = `${guildId}:${userId}`;
      const previousCreateAt = this.lastCreateAtByOwner.get(createKey);
      if (
        !replacingStaleRecord && previousCreateAt !== undefined &&
        now - previousCreateAt < this.createCooldownMs
      ) {
        throw new RoomConflictError("Room creation is on cooldown.", {
          retryAfterMs: this.createCooldownMs - (now - previousCreateAt),
        });
      }
      const usesRoomNumber = config.defaultNameTemplate.includes("{number}");
      let reservationId = null;
      let roomNumber = null;
      let createdChannelId = null;
      let room = null;
      let persistenceAttempted = false;
      try {
        if (usesRoomNumber) {
          reservationId = this.reservationIdFactory();
          roomNumber = this.configs.reserveNextRoomNumber(guildId, reservationId, now);
        }
        const name = renderRoomName(config.defaultNameTemplate, displayName, roomNumber);
        const created = await this.gateway.createRoom({
          guildId,
          categoryId: config.categoryId,
          name,
          userLimit: config.defaultUserLimit,
          ownerId: userId,
          moderatorRoleId: config.moderatorRoleId,
          mode: "open",
        });
        createdChannelId = created.channelId;
        if (reservationId) {
          this.configs.markNumberReservationChannel(
            guildId, reservationId, createdChannelId, "channel_created", this.clock.now()
          );
        }
        room = new AutoRoom({
          guildId,
          channelId: created.channelId,
          ownerId: userId,
          triggerChannelId: config.triggerChannelId,
          mode: "open",
          userLimit: config.defaultUserLimit,
          createdAt: now,
          updatedAt: now,
          roomNumber,
        });
        persistenceAttempted = true;
        if (reservationId) {
          this.rooms.createFromReservation(room, reservationId);
          reservationId = null;
        } else {
          this.rooms.create(room);
        }
        this.lastCreateAtByOwner.set(createKey, now);
      } catch (error) {
        let compensation = { confirmed: true, error: null };
        if (createdChannelId) {
          compensation = await this._deleteNewlyCreatedRoom({
            guildId,
            channelId: createdChannelId,
          });
        }
        if (reservationId && compensation.confirmed) {
          this._releaseReservation(guildId, reservationId);
        } else if (reservationId && !compensation.confirmed) {
          if (createdChannelId) {
            try {
              this.configs.markNumberReservationChannel(
                guildId, reservationId, createdChannelId, "orphaned", this.clock.now()
              );
            } catch (markError) {
              this.logger.error("Auto Voice Room orphan reservation marking failed", {
                guildId, channelId: createdChannelId, code: diagnosticCode(markError),
              });
            }
          }
          this.logger.error("Auto Voice Room persistence compensation incomplete", {
            guildId,
            channelId: createdChannelId,
            originalCode: diagnosticCode(error),
            compensationCode: diagnosticCode(compensation.error),
          });
        }
        if (persistenceAttempted) {
          const winner = this.rooms.findByOwner(guildId, userId);
          if (winner) {
            await this.gateway.moveMember({ guildId, userId, channelId: winner.channelId });
            return {
              created: false,
              channelId: winner.channelId,
              roomNumber: winner.roomNumber,
            };
          }
        }
        throw error;
      }

      try {
        await this.gateway.moveMember({ guildId, userId, channelId: room.channelId });
      } catch (error) {
        this.scheduleDeleteIfEmpty({ guildId, channelId: room.channelId, delaySeconds: config.emptyDeleteDelaySeconds });
        throw error;
      }
      return { created: true, channelId: room.channelId, roomNumber: room.roomNumber };
    });
  }

  _releaseReservation(guildId, reservationId) {
    try {
      this.configs.releaseNumberReservation(guildId, reservationId);
    } catch (releaseError) {
      this.logger.error("Auto Voice Room reservation release failed", {
        guildId,
        code: releaseError?.code,
      });
    }
  }

  async _deleteNewlyCreatedRoom(room) {
    try {
      await this.gateway.deleteRoom({
        guildId: room.guildId,
        channelId: room.channelId,
        reason: "Auto Voice Room persistence compensation",
      });
      return { confirmed: true, error: null };
    } catch (cleanupError) {
      if (cleanupError?.code === "UNKNOWN_CHANNEL") {
        return { confirmed: true, error: cleanupError };
      }
      return { confirmed: false, error: cleanupError };
    }
  }

  async handleVoiceDeparture({ guildId, channelId, userId }) {
    const room = this.rooms.findByChannel(channelId);
    if (!room || room.guildId !== guildId) return false;
    const snapshot = await this.gateway.getChannelSnapshot({ guildId, channelId });
    if (!snapshot) {
      this.rooms.deleteByChannelAndResetNumbering(channelId, guildId);
      return true;
    }
    if (!snapshot.isVoice || snapshot.guildId !== guildId || snapshot.managedMarker !== true) {
      this.rooms.deleteByChannelAndResetNumbering(channelId, guildId);
      return false;
    }

    const remaining = snapshot.members.filter((member) => !member.bot);
    if (remaining.length === 0) {
      const config = this.configs.findByGuild(guildId);
      this.scheduleDeleteIfEmpty({
        guildId,
        channelId,
        delaySeconds: config?.emptyDeleteDelaySeconds ?? DEFAULT_DELETE_DELAY_SECONDS,
      });
      return true;
    }

    if (room.ownerId === userId && !remaining.some((member) => member.id === room.ownerId)) {
      const nextOwnerId = this._selectEligibleOwner(room.guildId, room.channelId, remaining);
      if (nextOwnerId) await this._transferOwnership(room, nextOwnerId);
    }
    return true;
  }

  scheduleDeleteIfEmpty({ guildId, channelId, delaySeconds = DEFAULT_DELETE_DELAY_SECONDS }) {
    if (this.deleteTimers.has(channelId)) return false;
    const handle = this.scheduler.setTimeout(async () => {
      this.deleteTimers.delete(channelId);
      try {
        await this.deleteIfEmpty({ guildId, channelId });
      } catch (error) {
        this.logger.error("Auto Voice Room delayed cleanup failed", { channelId, code: error?.code });
      }
    }, Math.max(0, delaySeconds) * 1000);
    if (typeof handle?.unref === "function") handle.unref();
    this.deleteTimers.set(channelId, handle);
    return true;
  }

  async deleteIfEmpty({ guildId, channelId }) {
    return this.locks.run(`delete:${channelId}`, async () => {
      const room = this.rooms.findByChannel(channelId);
      if (!room || room.guildId !== guildId || room.systemMarker !== AutoRoom.SYSTEM_MARKER) return false;
      const snapshot = await this.gateway.getChannelSnapshot({ guildId, channelId });
      if (!snapshot) {
        this.rooms.deleteByChannelAndResetNumbering(channelId, guildId);
        return true;
      }
      if (
        !snapshot.isVoice || snapshot.guildId !== guildId ||
        snapshot.managedMarker !== true || snapshot.members.length > 0
      ) return false;

      try {
        await this.gateway.deleteRoom({ guildId, channelId, reason: "Auto Voice Room empty cleanup" });
      } catch (error) {
        if (error?.code !== "UNKNOWN_CHANNEL") throw error;
      }
      this.rooms.deleteByChannelAndResetNumbering(channelId, guildId);
      return true;
    });
  }

  async setMode({ guildId, channelId, actorId, adminOverride = false, mode }) {
    assertMode(mode);
    const { room } = await this._manageableRoom({ guildId, channelId, actorId, adminOverride });
    await this.gateway.setRoomMode({ guildId, channelId, mode });
    try {
      return this.rooms.update(channelId, { mode, updatedAt: this.clock.now() });
    } catch (error) {
      await this.gateway.setRoomMode({ guildId, channelId, mode: room.mode }).catch(() => {});
      throw error;
    }
  }

  async inviteUser(input) {
    return this._setUserAccess(input, "allowed");
  }

  async denyUser(input) {
    return this._setUserAccess(input, "denied");
  }

  async _setUserAccess({ guildId, channelId, actorId, adminOverride = false, userId }, access) {
    const { room } = await this._manageableRoom({ guildId, channelId, actorId, adminOverride });
    if (userId === room.ownerId) {
      throw new RoomValidationError("The room owner's access cannot be overridden.");
    }
    const previous = this.rooms.listGrants(channelId).find((grant) => grant.userId === userId);
    this.rooms.setGrant({ channelId, userId, access });
    try {
      await this.gateway.setUserAccess({ guildId, channelId, userId, access });
    } catch (error) {
      if (previous) this.rooms.setGrant(previous);
      else this.rooms.deleteGrant(channelId, userId);
      throw error;
    }
    return { channelId, userId, access };
  }

  async kickUser({ guildId, channelId, actorId, adminOverride = false, userId }) {
    const { room, snapshot } = await this._manageableRoom({ guildId, channelId, actorId, adminOverride });
    if (userId === room.ownerId) throw new RoomValidationError("The room owner cannot kick themselves.");
    if (!snapshot.members.some((member) => member.id === userId)) {
      throw new RoomValidationError("Target user is not in this managed room.");
    }
    await this.gateway.disconnectMember({ guildId, userId, expectedChannelId: channelId });
    return true;
  }

  async setLimit({ guildId, channelId, actorId, adminOverride = false, userLimit }) {
    assertLimit(userLimit);
    const { room } = await this._manageableRoom({ guildId, channelId, actorId, adminOverride });
    await this.gateway.setUserLimit({ guildId, channelId, userLimit });
    try {
      return this.rooms.update(channelId, { userLimit, updatedAt: this.clock.now() });
    } catch (error) {
      await this.gateway.setUserLimit({ guildId, channelId, userLimit: room.userLimit }).catch(() => {});
      throw error;
    }
  }

  async rename({ guildId, channelId, actorId, adminOverride = false, name }) {
    const { room } = await this._manageableRoom({ guildId, channelId, actorId, adminOverride });
    const now = this.clock.now();
    if (room.lastRenamedAt !== null && now - room.lastRenamedAt < this.renameCooldownMs) {
      throw new RoomConflictError("Room rename is on cooldown.", {
        retryAfterMs: this.renameCooldownMs - (now - room.lastRenamedAt),
      });
    }
    const sanitized = sanitizeRoomName(name);
    await this.gateway.renameRoom({ guildId, channelId, name: sanitized });
    this.rooms.update(channelId, { lastRenamedAt: now, updatedAt: now });
    return { channelId, name: sanitized };
  }

  async transfer({ guildId, channelId, actorId, adminOverride = false, userId }) {
    const { room, snapshot } = await this._manageableRoom({ guildId, channelId, actorId, adminOverride });
    if (userId === room.ownerId) throw new RoomValidationError("Target user already owns this room.");
    const target = snapshot.members.find((member) => member.id === userId && !member.bot);
    if (!target) throw new RoomValidationError("New owner must be a non-bot member in this room.");
    const owned = this.rooms.findByOwner(guildId, userId);
    if (owned && owned.channelId !== channelId) {
      throw new RoomConflictError("Target user already owns another managed room.");
    }
    return this._transferOwnership(room, userId);
  }

  async _transferOwnership(room, newOwnerId) {
    await this.gateway.transferOwnership({
      guildId: room.guildId,
      channelId: room.channelId,
      oldOwnerId: room.ownerId,
      newOwnerId,
    });
    try {
      return this.rooms.updateOwner(room.channelId, newOwnerId, this.clock.now());
    } catch (error) {
      await this.gateway.transferOwnership({
        guildId: room.guildId,
        channelId: room.channelId,
        oldOwnerId: newOwnerId,
        newOwnerId: room.ownerId,
      }).catch(() => {});
      throw error;
    }
  }

  _selectEligibleOwner(guildId, channelId, members) {
    const candidateIds = members
      .filter((member) => !member.bot)
      .map((member) => member.id)
      .sort();
    return candidateIds.find((candidateId) => {
      const owned = this.rooms.findByOwner(guildId, candidateId);
      return !owned || owned.channelId === channelId;
    }) || null;
  }

  async _manageableRoom({ guildId, channelId, actorId, adminOverride }) {
    const room = this.rooms.findByChannel(channelId);
    if (!room || room.guildId !== guildId || room.systemMarker !== AutoRoom.SYSTEM_MARKER) {
      throw new RoomNotFoundError({ guildId, channelId });
    }
    if (!mayManageRoom({ actorId, ownerId: room.ownerId, adminOverride })) {
      throw new RoomAuthorizationError({ actorId, channelId });
    }
    const snapshot = await this.gateway.getChannelSnapshot({ guildId, channelId });
    if (!snapshot?.isVoice || snapshot.guildId !== guildId || snapshot.managedMarker !== true) {
      throw new RoomNotFoundError({ guildId, channelId });
    }
    if (!adminOverride && !snapshot.members.some((member) => member.id === room.ownerId)) {
      throw new RoomAuthorizationError({ actorId, channelId, reason: "owner_not_in_room" });
    }
    return { room, snapshot };
  }

  async reconcile() {
    const result = { configsDisabled: 0, staleRecordsRemoved: 0, emptyRoomsDeleted: 0, ownersTransferred: 0 };
    const visibleGuildIds = new Set(await this.gateway.listVisibleGuildIds());
    for (const config of this.configs.listAll()) {
      if (!visibleGuildIds.has(config.guildId)) continue;
      const now = this.clock.now();
      await this._reconcileNumberReservations(config.guildId);
      this.configs.resetNumberingIfNoManagedRooms(config.guildId, now);
      if (!config.enabled) continue;
      let valid;
      try {
        valid = await this.gateway.validateConfig(config);
      } catch (error) {
        this.logger.error("Auto Voice Room config reconciliation failed", {
          guildId: config.guildId,
          code: error?.code,
        });
        continue;
      }
      if (!valid) {
        this.configs.disable(config.guildId, this.clock.now());
        result.configsDisabled += 1;
      }
    }

    for (const listedRoom of this.rooms.listAll()) {
      if (!visibleGuildIds.has(listedRoom.guildId)) continue;
      const room = this.rooms.findByChannel(listedRoom.channelId);
      if (!room || room.systemMarker !== AutoRoom.SYSTEM_MARKER) continue;
      const snapshot = await this.gateway.getChannelSnapshot({ guildId: room.guildId, channelId: room.channelId });
      if (!snapshot) {
        this.rooms.deleteByChannelAndResetNumbering(room.channelId, room.guildId);
        result.staleRecordsRemoved += 1;
        continue;
      }
      if (!snapshot.isVoice || snapshot.guildId !== room.guildId || snapshot.managedMarker !== true) {
        this.rooms.deleteByChannelAndResetNumbering(room.channelId, room.guildId);
        result.staleRecordsRemoved += 1;
        this.logger.warn("Auto Voice Room reconciliation removed a stale unmarked record", {
          channelId: room.channelId,
        });
        continue;
      }
      const members = snapshot.members.filter((member) => !member.bot);
      if (members.length === 0) {
        if (await this.deleteIfEmpty({ guildId: room.guildId, channelId: room.channelId })) {
          result.emptyRoomsDeleted += 1;
        }
        continue;
      }
      if (!members.some((member) => member.id === room.ownerId)) {
        const nextOwnerId = this._selectEligibleOwner(room.guildId, room.channelId, members);
        if (nextOwnerId) {
          await this._transferOwnership(room, nextOwnerId);
          result.ownersTransferred += 1;
        }
      }
    }
    return result;
  }

  async _reconcileNumberReservations(guildId) {
    const reservations = this.configs.listNumberReservations(guildId);
    for (const reservation of reservations) {
      // An unbound reservation may represent a process crash immediately after Discord create.
      // Time is never proof that its number is safe to reuse.
      if (!reservation.channelId) continue;
      // channel_created is owned by a live/finalizing creator. Only an explicitly
      // orphaned reservation may be claimed for external cleanup.
      if (reservation.state !== "orphaned") continue;
      if (!this.configs.claimOrphanedNumberReservation(
        guildId, reservation.reservationId, this.clock.now()
      )) continue;
      let snapshot;
      try {
        snapshot = await this.gateway.getChannelSnapshot({ guildId, channelId: reservation.channelId });
      } catch (error) {
        this.configs.markNumberReservationChannel(
          guildId, reservation.reservationId, reservation.channelId, "orphaned", this.clock.now()
        );
        this.logger.error("Auto Voice Room reservation reconciliation failed", {
          guildId, channelId: reservation.channelId, code: diagnosticCode(error),
        });
        continue;
      }
      if (!snapshot) {
        this._releaseReservation(guildId, reservation.reservationId);
        continue;
      }
      if (!snapshot.isVoice || snapshot.guildId !== guildId || snapshot.managedMarker !== true) {
        this.configs.markNumberReservationChannel(
          guildId, reservation.reservationId, reservation.channelId, "orphaned", this.clock.now()
        );
        continue;
      }
      try {
        await this.gateway.deleteRoom({
          guildId, channelId: reservation.channelId,
          reason: "Auto Voice Room orphan reservation reconciliation",
        });
        this._releaseReservation(guildId, reservation.reservationId);
      } catch (error) {
        if (error?.code === "UNKNOWN_CHANNEL") {
          this._releaseReservation(guildId, reservation.reservationId);
        } else {
          this.configs.markNumberReservationChannel(
            guildId, reservation.reservationId, reservation.channelId, "orphaned", this.clock.now()
          );
          this.logger.error("Auto Voice Room orphan cleanup failed", {
            guildId, channelId: reservation.channelId, code: diagnosticCode(error),
          });
        }
      }
    }
  }
}

module.exports = AutoRoomService;
module.exports.KeyedMutex = KeyedMutex;
module.exports.sanitizeRoomName = sanitizeRoomName;
module.exports.renderRoomName = renderRoomName;

function diagnosticCode(error) {
  const value = error?.code ?? error?.name ?? "UNKNOWN";
  return String(value).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 64) || "UNKNOWN";
}
