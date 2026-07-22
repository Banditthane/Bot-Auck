

const LogLevels = require("./LogLevels");
const LogContext = require("./LogContext");

class Logger {

  log(level, message, context = {}) {

    const time = new Date().toLocaleString("th-TH");

    // อ่านค่าจาก LogContext
    const requestId = LogContext.get("requestId") ?? "-";
    const shardId = LogContext.get("shardId") ?? context.shardId ?? "-";

    const pid = process.pid;

    console.log(
      `[${time}] [${level}] [Shard:${shardId}] [PID:${pid}] [Req:${requestId}] ${message}`
    );

  }

  info(message, context) {
    this.log(LogLevels.INFO, message, context);
  }

  warn(message, context) {
    this.log(LogLevels.WARN, message, context);
  }

  error(message, context) {
    this.log(LogLevels.ERROR, message, context);
  }

  debug(message, context) {
    this.log(LogLevels.DEBUG, message, context);
  }

  dev(message, context) {
    this.log(LogLevels.DEV, message, context);
  }

}

module.exports = Logger;











// const LogLevels = require("./LogLevels");

// class Logger {

//   log(level, message, context = {}) {
//     // const time = new Date().toISOString();
//     const time = new Date().toLocaleString("th-TH");


//     const shard = context.shardId ?? "-";
//     const pid = context.pid ?? process.pid;
//     const requestId = context.requestId ?? "-";

//     console.log(
//       `[${time}] [${level}] [Shard:${shard}] [PID:${pid}] [Req:${requestId}] ${message}`
//     );
//   }

//   info(message, context) {
//     this.log(LogLevels.INFO, message, context);
//   }

//   warn(message, context) {
//     this.log(LogLevels.WARN, message, context);
//   }

//   error(message, context) {
//     this.log(LogLevels.ERROR, message, context);
//   }

//   debug(message, context) {
//     this.log(LogLevels.DEBUG, message, context);
//   }

//   dev(message, context) {
//     this.log(LogLevels.DEV, message, context);
//   }

// }

// module.exports = Logger;

