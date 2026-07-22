class AutoRoomRepository {
  findByOwner() { throw new Error("findByOwner() is not implemented."); }
  findByChannel() { throw new Error("findByChannel() is not implemented."); }
  listAll() { throw new Error("listAll() is not implemented."); }
  create() { throw new Error("create() is not implemented."); }
  createFromReservation() { throw new Error("createFromReservation() is not implemented."); }
  update() { throw new Error("update() is not implemented."); }
  updateOwner() { throw new Error("updateOwner() is not implemented."); }
  deleteByChannel() { throw new Error("deleteByChannel() is not implemented."); }
  deleteByChannelAndResetNumbering() {
    throw new Error("deleteByChannelAndResetNumbering() is not implemented.");
  }
  listGrants() { throw new Error("listGrants() is not implemented."); }
  setGrant() { throw new Error("setGrant() is not implemented."); }
  deleteGrant() { throw new Error("deleteGrant() is not implemented."); }
}

module.exports = AutoRoomRepository;
