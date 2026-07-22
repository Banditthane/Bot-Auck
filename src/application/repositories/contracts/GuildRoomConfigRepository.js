class GuildRoomConfigRepository {
  findByGuild() { throw new Error("findByGuild() is not implemented."); }
  listAll() { throw new Error("listAll() is not implemented."); }
  upsert() { throw new Error("upsert() is not implemented."); }
  reserveNextRoomNumber() { throw new Error("reserveNextRoomNumber() is not implemented."); }
  markNumberReservationChannel() {
    throw new Error("markNumberReservationChannel() is not implemented.");
  }
  listNumberReservations() { throw new Error("listNumberReservations() is not implemented."); }
  claimOrphanedNumberReservation() {
    throw new Error("claimOrphanedNumberReservation() is not implemented.");
  }
  releaseNumberReservation() { throw new Error("releaseNumberReservation() is not implemented."); }
  resetNumberingIfNoManagedRooms() {
    throw new Error("resetNumberingIfNoManagedRooms() is not implemented.");
  }
  disable() { throw new Error("disable() is not implemented."); }
}

module.exports = GuildRoomConfigRepository;
