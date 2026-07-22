// class ServerService {
//   constructor(storage) {
//     this.storage = storage;
//   }

//   registerGuild(guildId) {
//     const servers = this.storage.loadServers();

//     if (!servers.includes(guildId)) {
//       servers.push(guildId);
//       this.storage.saveServers(servers);
//     }
//   }
// }

// module.exports = ServerService;