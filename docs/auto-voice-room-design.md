# Auto Voice Room System Design

## 1. Goal

ระบบสร้างห้องเสียงส่วนตัวอัตโนมัติสำหรับ Discord โดยผู้ใช้เข้าห้อง `➕ Create Room` แล้วบอทจะ:

1. สร้างห้องเสียงใหม่ในหมวดที่กำหนด
2. ย้ายผู้ใช้เข้าไปในห้องใหม่
3. กำหนดผู้ใช้เป็นเจ้าของห้อง
4. เปิดให้เจ้าของจัดการ lock, invite, PIN, limit, rename และ kick
5. ลบห้องพร้อมข้อมูลชั่วคราวเมื่อไม่มีสมาชิกเหลือ

## 2. Scope

### MVP

- Join-to-create ผ่านห้องต้นทางหนึ่งห้องต่อเซิร์ฟเวอร์
- ห้องชั่วคราวหนึ่งห้องต่อเจ้าของต่อเซิร์ฟเวอร์
- Auto move หลังสร้างห้อง
- Auto delete เมื่อห้องว่าง
- Owner-only controls: lock, unlock, invite/permit, reject/deny, kick, limit, rename, transfer ownership
- Admin/Manage Channels override
- กู้สถานะหลังบอท restart และเก็บกวาดห้องค้าง

### Optional extension

- PIN สำหรับขอเข้าห้องผ่านคำสั่งหรือปุ่ม (Discord voice channel ไม่มี native PIN)
- Waiting room และคำขออนุมัติเข้าห้อง
- Block list รายห้อง
- Co-owner
- Room presets และชื่อห้องแบบ template
- Activity/audit log

## 3. User Flow

```text
สมาชิกเข้า ➕ Create Room
        |
        v
ตรวจ config + rate limit + ห้องเดิมของผู้ใช้
        |
        +-- มีห้องเดิม --> ย้ายกลับเข้าห้องเดิม
        |
        +-- ไม่มี --> สร้าง voice channel ใต้ category ที่ตั้งไว้
                         |
                         v
                  บันทึก owner + settings
                         |
                         v
                    ย้ายสมาชิกเข้าห้อง
                         |
                         v
              เจ้าของใช้ /room หรือ control panel
                         |
                         v
          สมาชิกคนสุดท้ายออก --> ตรวจซ้ำ --> ลบห้อง + record
```

หากเจ้าของออกแต่ยังมีสมาชิกอยู่ ห้องจะยังไม่ถูกลบ ระบบเลือกเจ้าของใหม่ตามลำดับ: co-owner (ถ้ามี) แล้วสมาชิกที่อยู่มานานที่สุด หากไม่มีสมาชิกจึงลบห้องทันที

## 4. Room Privacy Model

ใช้ permission overwrite ของ Discord เป็นหลัก:

| Mode | `@everyone` ViewChannel | `@everyone` Connect | ผู้ได้รับเชิญ Connect |
|---|---:|---:|---:|
| open | inherit/allow | allow | allow |
| locked | allow | deny | allow |
| hidden | deny | deny | allow |

กติกา:

- Owner ได้ `ViewChannel`, `Connect`, `Speak`, `MoveMembers` เฉพาะเท่าที่จำเป็น
- Bot ต้องมี `ManageChannels` และ `MoveMembers`
- สิทธิ์ admin และ role ที่กำหนดเป็น moderator ไม่ถูก owner ปิดกั้น
- `kick` หมายถึง disconnect สมาชิกออกจาก voice room ไม่ใช่ kick ออกจากเซิร์ฟเวอร์
- `deny` ลบสิทธิ์เชิญและตั้ง `Connect: false` ให้สมาชิกคนนั้น

## 5. Invite and PIN

### Invite by Discord ID/user mention

คำสั่ง `/room invite user:@member` เพิ่ม permission overwrite ให้ผู้ใช้เข้าได้แม้ห้อง lock และตอบกลับแบบ ephemeral เจ้าของสามารถส่ง mention หรือ Discord user ID ได้

### PIN

Discord ไม่รองรับรหัสผ่านตอนกดเข้าห้องเสียงโดยตรง จึงออกแบบ PIN เป็น application gate:

1. เจ้าของใช้ `/room pin set code:<4-8 digits>`
2. ผู้ขอใช้ `/room join room:<room-id> pin:<code>`
3. บอทตรวจ hash ของ PIN แล้วเพิ่มสิทธิ์ `Connect` ชั่วคราว
4. PIN ผิดเกินกำหนดถูก cooldown เพื่อกัน brute force

ห้ามเก็บ PIN แบบ plaintext; เก็บ `pinHash` และไม่เขียน PIN ลง log

## 6. Commands

ใช้ command group เดียวเพื่อลดความรก:

| Command | Actor | Result |
|---|---|---|
| `/room panel` | owner | แสดง control panel แบบ ephemeral |
| `/room lock` | owner | ปิด Connect สำหรับ everyone |
| `/room unlock` | owner | เปิด Connect |
| `/room hide` | owner | ซ่อนห้องจากผู้ไม่ได้รับอนุญาต |
| `/room invite user` | owner | อนุญาตผู้ใช้ |
| `/room deny user` | owner | ถอน/ปิดสิทธิ์ผู้ใช้ |
| `/room kick user` | owner | ตัดผู้ใช้ออกจากห้อง |
| `/room limit number` | owner | ตั้ง 0-99; 0 = unlimited |
| `/room rename name` | owner | เปลี่ยนชื่อโดยมี cooldown |
| `/room transfer user` | owner | โอนเจ้าของให้สมาชิกในห้อง |
| `/room pin set/remove` | owner | ตั้งหรือลบ PIN |
| `/room join room pin` | member | ขอสิทธิ์เข้าห้องด้วย PIN |
| `/room setup` | admin | ตั้ง trigger channel/category/log channel |

ทุก response ที่มีข้อมูลการจัดการหรือ PIN ต้องเป็น ephemeral

## 7. Domain Model

### AutoRoom

```js
{
  guildId,
  channelId,
  ownerId,
  triggerChannelId,
  mode: "open" | "locked" | "hidden",
  userLimit,
  pinHash: null,
  createdAt,
  updatedAt
}
```

### RoomGrant

```js
{
  channelId,
  userId,
  access: "allowed" | "denied",
  expiresAt: null
}
```

### GuildRoomConfig

```js
{
  guildId,
  triggerChannelId,
  categoryId,
  logChannelId,
  moderatorRoleId,
  defaultNameTemplate: "{displayName}'s room",
  defaultUserLimit: 0,
  emptyDeleteDelaySeconds: 5,
  enabled: true
}
```

Unique constraints: `AutoRoom.channelId`, `(guildId, ownerId)` และ `GuildRoomConfig.guildId`

## 8. Architecture Mapping

รักษาทิศทาง dependency: `interfaces -> application -> domain`; infrastructure เป็นผู้ implement ports

```text
domain/
  entities/AutoRoom.js
  policies/RoomPermissionPolicy.js
  errors/RoomErrors.js

application/
  services/AutoRoomService.js
  repositories/contracts/AutoRoomRepository.js
  repositories/contracts/GuildRoomConfigRepository.js
  dto/RoomControlRequest.js

infrastructure/
  database/ (schema/migration)
  database/repositories/SqliteAutoRoomRepository.js
  providers/discord/DiscordRoomGateway.js

interfaces/discord/
  events/voice/voiceStateUpdate.js
  events/client/ready.js (reconciliation hook)
  commands/room/*
  commands/admin/room-setup/*
```

`AutoRoomService` ไม่ควร import `discord.js` โดยตรง ให้เรียก port/gateway เพื่อให้ทดสอบ business flow ได้โดยไม่ต้องต่อ Discord

## 9. Event Rules and Race Safety

### voiceStateUpdate

- Ignore bot users
- เมื่อ `newState.channelId === triggerChannelId`: เรียก `createOrMoveToOwnedRoom`
- เมื่อออกจาก managed room: schedule delete หลัง delay สั้น ๆ
- ก่อนลบ fetch channel ใหม่และตรวจ `members.size === 0` อีกครั้ง
- ใช้ lock key `guildId:userId` ตอนสร้าง และ `channelId` ตอนลบ เพื่อกัน event ซ้อนสร้าง/ลบซ้ำ

### Failure compensation

- สร้าง channel สำเร็จแต่บันทึก DB ล้มเหลว: ลบ channel ที่เพิ่งสร้าง
- บันทึกสำเร็จแต่ move ล้มเหลว: คงห้องไว้ช่วงสั้นและลบหากว่าง
- Discord ตอบ Unknown Channel: ลบ stale record
- ห้ามลบ channel ใด ๆ ที่ไม่มี managed-room record หรือ marker ของระบบ

### Restart reconciliation

เมื่อ ready:

1. โหลด managed rooms ทั้งหมด
2. record มีแต่ channel ไม่มี: ลบ record
3. channel มีและว่าง: ลบ channel แล้วลบ record
4. owner ไม่อยู่แต่มีสมาชิก: transfer owner
5. ตรวจ trigger/category config; ถ้าหายให้ disable config และ log แจ้ง admin

## 10. Required Discord Configuration

- เพิ่ม Gateway intent `GuildVoiceStates`
- Bot permissions: `ViewChannel`, `Connect`, `ManageChannels`, `MoveMembers`, `SendMessages`, `UseApplicationCommands`
- เปิดใช้ slash commands สำหรับ guild ระหว่างพัฒนา
- ควรให้ role ของ bot อยู่สูงพอสำหรับการจัดการ permission ที่จำเป็น

## 11. Security and Abuse Controls

- Owner action ต้องตรวจทั้ง managed room, owner ID และสมาชิกอยู่ในห้องนั้น
- Admin override ต้องตรวจ `ManageChannels` ไม่ใช้ชื่อ role
- จำกัดสร้างห้อง: 1 ห้อง/ผู้ใช้/เซิร์ฟเวอร์
- Cooldown การสร้างและ rename
- จำกัดความยาวชื่อและกรอง control characters/mentions
- PIN 4-8 หลัก, hash พร้อม salt, จำกัดครั้งผิดต่อ user+room
- ห้ามรับ channel ID ข้าม guild
- Structured audit log: create, delete, transfer, lock, grant, deny, kick; ไม่ log PIN

## 12. Acceptance Criteria

1. เข้าห้อง trigger แล้วได้ห้องใหม่และถูกย้ายภายในเวลาปกติของ Discord API
2. Event ซ้ำไม่สร้างมากกว่าหนึ่งห้องต่อผู้ใช้
3. Owner lock/unlock, invite, deny, kick, limit, rename และ transfer ได้
4. ผู้ไม่ใช่ owner ถูกปฏิเสธทุก owner-only action ยกเว้น admin override
5. ผู้ได้รับ invite เข้า locked room ได้; ผู้อื่นเข้าไม่ได้
6. PIN ที่ถูกต้องให้สิทธิ์เข้า; PIN ผิดไม่เปิดเผยข้อมูลและมี rate limit
7. ห้องถูกลบเมื่อว่าง และไม่ลบห้องปกติของเซิร์ฟเวอร์
8. เมื่อ owner ออกแต่ยังมีสมาชิก ระบบ transfer owner ตาม policy
9. หลัง restart ไม่มี stale record หรือ managed room ว่างค้าง
10. ทุก failure path มี log และไม่ทิ้ง channel/record ครึ่งสถานะ

## 13. Test Plan

- Unit: ownership policy, permission mode, rename validation, PIN verification/rate limit
- Service: create success, duplicate event, move failure compensation, delete race, transfer owner
- Repository: unique constraints, CRUD, stale cleanup
- Adapter: permission overwrite mapping และ Discord error mapping
- Manual Discord: join trigger, lock/invite/join, kick, owner leave, last member leave, bot restart

## 14. Delivery Stages

1. Foundation: intent, domain model, repository schema/ports, Discord gateway
2. Lifecycle: join-to-create, auto move, auto delete, restart reconciliation
3. Controls: command group, lock/unlock, invite/deny, kick, limit, rename, transfer
4. PIN/waiting flow: secure PIN gate, rate limiting, ephemeral responses
5. Hardening: audit logs, race tests, permission tests, operational documentation

## 15. Current Baseline

- Repository: `H:\BoT AucK\4uck-Efaris\Bot-Auck`
- Branch: `main`
- Baseline commit: `UNKNOWN` (repository has no commits yet)
- Existing voice-room implementation: none found
- Existing automated test command: none (`npm test` currently exits with error by design)

