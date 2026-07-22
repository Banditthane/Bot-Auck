<!-- https://www.w3schools.com/js/js_modules.asp
https://old.discordjs.dev/#/docs/discord.js/main/general/welcome -->

<!-- Hybrid Architecture -->

4UCK-EFARIS/
└── src/
ㅤㅤ│
ㅤㅤ├── auck/ ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- !Custom modules
ㅤㅤ│
ㅤㅤ│
ㅤㅤ│

<!-- create bot
load events
load commands
inject services ↓-->

ㅤㅤ├── core/ ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- !Bot bootstrap / DI container
ㅤㅤㅤㅤ├── Bot.js ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- [***] สร้างและเริ่ม Discord Client
ㅤㅤㅤㅤ├── Container.js ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- [***] สร้าง services ของระบบ
ㅤㅤㅤㅤ├── CommandRegistry.js ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- [***] เก็บคำสั่งทั้งหมดของบอท
ㅤㅤㅤㅤ├── EventLoader.js ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- [***] โหลด event ของ Discord
ㅤㅤㅤㅤ├── EventRegistry.js [x] ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- [***]
ㅤㅤㅤㅤ└── InteractionRouter.js ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- [***] ส่ง command ไป handler ที่ถูกต้อง
ㅤㅤ│
ㅤㅤ│
ㅤㅤ│
ㅤㅤ├── domain/ ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- !Entities / business models
ㅤㅤㅤㅤ├── entities/
ㅤㅤㅤㅤ├── valueObjects/
ㅤㅤㅤㅤ├── policies/
ㅤㅤㅤㅤ├── events/
ㅤㅤㅤㅤ└── errors/
ㅤㅤ│
ㅤㅤ│
ㅤㅤ│
ㅤㅤ├── application/ ㅤ ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- ! ใช้เขียน Use Cases
ㅤㅤㅤㅤ├── services/
ㅤㅤㅤㅤ├── dto/
ㅤㅤㅤㅤ├── repositories/
ㅤㅤㅤㅤ├── errors/
ㅤㅤ│
ㅤㅤ│
ㅤㅤ│
ㅤㅤ├── interfaces/ ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- !Discord adapters (events / commands)
ㅤㅤㅤㅤ├── discord/
ㅤㅤㅤㅤㅤㅤ├── commands/
ㅤㅤㅤㅤㅤㅤㅤㅤ├── verify/
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── .js
ㅤㅤㅤㅤㅤㅤㅤㅤ├── misc/
ㅤㅤㅤㅤㅤㅤㅤㅤ├── utility/
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── ping/ ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ<!--→ check bot ทำงานไหม
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── help/ ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ<!--→ แสดงคำสั่งทั้งหมด
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── avatar/ ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ<!--→ ดู avatar user
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── userinfo/ ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ<!--→ ข้อมูล user
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── serverinfo/ ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ<!--→ ข้อมูล server
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── invite/ ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ<!--→ ลิงค์เชิญบอท
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js

ㅤㅤㅤㅤㅤㅤㅤㅤ├── moderation/
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── kick/ ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ<!--→ เตะ user
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── ban/ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ<!--→ แบน user
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── unban/
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── mute/ ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ<!--→ mute user
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── unmute/
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── warn/ ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ<!--→ เตือน user
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── warnings/ ㅤㅤㅤ ㅤㅤㅤㅤ<!--→ ดูประวัติ warn
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── clear/ ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ<!--→ ลบข้อความ
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── command.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── handler.js
ㅤㅤㅤㅤㅤㅤㅤㅤ└── admin
ㅤㅤㅤㅤㅤㅤ├── events/ㅤㅤㅤㅤㅤㅤㅤㅤ <!-- Discord Gateway Events
ㅤㅤㅤㅤㅤㅤㅤㅤ├── client/
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ├── ready.js
ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ└── interactionCreate.js
ㅤㅤㅤㅤㅤㅤㅤㅤ├── guild/
ㅤㅤㅤㅤㅤㅤㅤㅤ├── member/
ㅤㅤㅤㅤㅤㅤㅤㅤ└── message/
ㅤㅤㅤㅤㅤㅤ├── middleware/ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ <!-- Internal / EventBus listeners
ㅤㅤㅤㅤㅤㅤ├── adapters/ㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤㅤ<!-- Discord adapters (wrap discord.js operations)
ㅤㅤㅤㅤ└── http/
ㅤㅤㅤㅤㅤㅤ├── routes/
ㅤㅤㅤㅤㅤㅤ├── controllers/
ㅤㅤㅤㅤㅤㅤ└── middleware/
ㅤㅤ│
ㅤㅤ│
ㅤㅤ│
ㅤㅤ├── infrastructure/ ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- !Database / logger / external systems
ㅤㅤㅤㅤ├── database/
ㅤㅤㅤㅤㅤㅤ├── sqlite.jsㅤㅤㅤㅤㅤㅤㅤ<!-- (+) 13.3.69 [OAuth2]
ㅤㅤㅤㅤㅤㅤ└── repositories/
ㅤㅤㅤㅤㅤㅤㅤㅤ├──
ㅤㅤㅤㅤ├── cache/
ㅤㅤㅤㅤ├── logging/
ㅤㅤㅤㅤㅤㅤ├── Logger.jsㅤㅤㅤㅤㅤㅤㅤ<!-- (+) 14.3.69 [log]
ㅤㅤㅤㅤㅤㅤ├── DevLogger.jsㅤㅤㅤㅤㅤㅤㅤ<!-- (+) 14.3.69 [log]
ㅤㅤㅤㅤㅤㅤ└── LogLevels.jsㅤㅤㅤㅤㅤㅤㅤ<!-- (+) 14.3.69 [log]
ㅤㅤㅤㅤ├── monitoring/
ㅤㅤㅤㅤㅤㅤ├── Metrics.js
ㅤㅤㅤㅤㅤㅤ└── HealthCheck.js
ㅤㅤㅤㅤ├── oauth/ㅤㅤㅤㅤㅤㅤㅤ<!-- (+) 13.3.69 [OAuth2]
ㅤㅤㅤㅤㅤㅤ├── OAuthServer.js
ㅤㅤㅤㅤㅤㅤ├── DiscordOAuthService.js
ㅤㅤㅤㅤㅤㅤ└── routes/
ㅤㅤㅤㅤㅤㅤㅤㅤ├── auth.js
ㅤㅤㅤㅤㅤㅤㅤㅤ└── callback.js
ㅤㅤㅤㅤ├── eventBus ㅤㅤㅤㅤㅤㅤㅤ<!-- (+) 13.3.69 [OAuth2]
ㅤㅤㅤㅤㅤㅤ├── EventBus.js
ㅤㅤㅤㅤ├── config/ ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- !
ㅤㅤㅤㅤㅤㅤ├── roles/ ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- ?เก็บ ยศ(ID)
ㅤㅤㅤㅤ└── cronJob/ ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- !Background jobs
ㅤㅤ│
ㅤㅤ│
ㅤㅤ│
ㅤㅤ├── shared/ ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- !Helper utilities
ㅤㅤㅤㅤ├── constants
ㅤㅤㅤㅤㅤㅤ├── Roles.js
ㅤㅤㅤㅤㅤㅤ└── Permissions.js
ㅤㅤㅤㅤ├── errors/
ㅤㅤㅤㅤㅤㅤ└── AppError.js
ㅤㅤㅤㅤ├── helpers/
ㅤㅤㅤㅤㅤㅤ├──
ㅤㅤㅤㅤㅤㅤ└──
ㅤㅤ│
ㅤㅤ│
ㅤㅤ│
ㅤㅤ├── types/ ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- !Type definitions
ㅤㅤ│
ㅤㅤ│
ㅤㅤ│
ㅤㅤ├── index.js ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- [***] !ShardingManager entry
ㅤㅤ├── shard.js ㅤㅤㅤㅤㅤㅤㅤㅤ<!-- [***] !Shard process entry
ㅤㅤ└── server.jsㅤㅤㅤㅤㅤㅤㅤㅤ<!--# HTTP server (OAuth)

<!-- src/index.js
   ↓
ShardingManager
   ↓
shard.js
   ↓
core/container.js
   ↓
core/Bot.js
   ↓
EventLoader
   ↓
Discord events
   ↓
Commands
   ↓
Services -->
