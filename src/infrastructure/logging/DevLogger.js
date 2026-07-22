const Logger = require("./Logger");

class DevLogger extends Logger {

  dev(message) {
    const time = new Date().toLocaleString("th-TH");

    console.log(
      `\x1b[36m[${time}] [DEV] ${message}\x1b[0m`
    );
  }

  debug(message) {
    const time = new Date().toLocaleString("th-TH");

    console.log(
      `\x1b[35m[${time}] [DEBUG] ${message}\x1b[0m`
    );
  }

}

module.exports = DevLogger;


// const chalk = require("chalk");

// function time() {
//   return new Date().toLocaleTimeString();
// }

// class DevLogger {

//   static info(scope, message) {
//     console.log(
//       chalk.blue(`[INFO]`),
//       chalk.gray(time()),
//       chalk.yellow(`[${scope}]`),
//       message
//     );
//   }

//   static error(scope, message) {
//     console.log(
//       chalk.red(`[ERROR]`),
//       chalk.gray(time()),
//       chalk.yellow(`[${scope}]`),
//       message
//     );
//   }

//   static debug(scope, message) {
//     console.log(
//       chalk.magenta(`[DEBUG]`),
//       chalk.gray(time()),
//       chalk.yellow(`[${scope}]`),
//       message
//     );
//   }

// }

// module.exports = DevLogger;