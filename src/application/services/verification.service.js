// const userRepository = require("../../infrastructure/database/user.repository");
// const DiscordAdapter = require("../../interfaces/discord/discord.adapter");

// class VerificationService {
//   constructor(client) {
//     this.discord = new DiscordAdapter(client);
//   }

//   async execute(userData) {
//     const existing = userRepository.findById(userData.id);

//     if (existing && existing.verified) {
//       return { status: "already_verified" };
//     }

//     // Save first (Business state)
//     userRepository.save(userData);

//     // Then assign role
//     await this.discord.addMember(
//       userData.guild_id,
//       userData.id,
//       userData.access_token,
//     );

//     await this.discord.assignRole(
//       userData.guild_id,
//       userData.id,
//       process.env.VERIFIED_ROLE_ID,
//     );

//     return { status: "verified" };
//   }
// }

// module.exports = VerificationService;
