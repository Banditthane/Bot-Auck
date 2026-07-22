require("dotenv").config()

const fs = require("fs")
const path = require("path")

let chalk

async function loadChalk() {
  const module = await import("chalk")
  chalk = module.default
}

const ROOT = path.join(__dirname, "..")

const results = {
  commands: [],
  events: [],
  services: [],
  repositories: [],
  errors: 0
}

function readFiles(dir) {

  if (!fs.existsSync(dir)) return []

  let list = []
  const files = fs.readdirSync(dir)

  for (const file of files) {

    const full = path.join(dir, file)
    const stat = fs.statSync(full)

    if (stat.isDirectory()) {
      list = list.concat(readFiles(full))
      continue
    }

    if (file.endsWith(".js")) {
      list.push(full)
    }

  }

  return list
}

function logError(type, name, file, err) {

  console.log("")
  console.log(chalk.red(`${type} ERROR`))
  console.log("Name :", name)
  console.log("File :", file)
  console.log("Reason :", err.message)
  console.log("")

}

function checkCommands() {

  const dir = path.join(ROOT, "interfaces/discord/commands")
  const files = readFiles(dir)

  for (const file of files) {

    const name = path.basename(file, ".js")

    try {

      const command = require(file)

      if (!command.execute) {
        throw new Error("missing execute()")
      }

      results.commands.push({
        name,
        status: "OK"
      })

    } catch (err) {

      results.commands.push({
        name,
        status: "ERROR",
        error: err.message
      })

      logError("COMMAND", name, file, err)

      results.errors++

    }

  }

}

function checkEvents() {

  const dir = path.join(ROOT, "interfaces/discord/events")
  const files = readFiles(dir)

  for (const file of files) {

    const name = path.basename(file, ".js")

    try {

      const event = require(file)

      if (!event.execute) {
        throw new Error("missing execute()")
      }

      results.events.push({
        name,
        status: "OK"
      })

    } catch (err) {

      results.events.push({
        name,
        status: "ERROR",
        error: err.message
      })

      logError("EVENT", name, file, err)

      results.errors++

    }

  }

}

function checkServices() {

  const dir = path.join(ROOT, "application/services")
  const files = readFiles(dir)

  for (const file of files) {

    const name = path.basename(file, ".js")

    try {

      const service = require(file)

      if (!service) {
        throw new Error("invalid service export")
      }

      results.services.push({
        name,
        status: "OK"
      })

    } catch (err) {

      results.services.push({
        name,
        status: "ERROR",
        error: err.message
      })

      logError("SERVICE", name, file, err)

      results.errors++

    }

  }

}

function checkRepositories() {

  const dir = path.join(ROOT, "infrastructure/database/repositories")
  const files = readFiles(dir)

  for (const file of files) {

    const name = path.basename(file, ".js")

    try {

      require(file)

      results.repositories.push({
        name,
        status: "OK"
      })

    } catch (err) {

      results.repositories.push({
        name,
        status: "ERROR",
        error: err.message
      })

      logError("REPOSITORY", name, file, err)

      results.errors++

    }

  }

}

function checkEnv() {

  console.log("")
  console.log(chalk.cyan("BOOT"))

  if (!process.env.TOKEN) {

    console.log(chalk.red("✗ Discord token missing"))
    results.errors++

  } else {

    console.log(chalk.green("✓ Discord token valid"))

  }

}

function checkDatabase() {

  console.log("")
  console.log(chalk.cyan("DATABASE"))

  if (!process.env.MONGO_URI) {

    console.log(chalk.red("✗ Mongo URI missing"))
    results.errors++

  } else {

    console.log(chalk.green("✓ Mongo URI configured"))

  }

}

function checkArchitecture() {

  console.log("")
  console.log(chalk.cyan("ARCHITECTURE"))

  const folders = [
    "application",
    "domain",
    "infrastructure",
    "interfaces"
  ]

  let missing = []

  for (const folder of folders) {

    const full = path.join(ROOT, folder)

    if (!fs.existsSync(full)) {
      missing.push(folder)
    }

  }

  if (missing.length > 0) {

    console.log(chalk.red("✗ Missing folders:"), missing.join(", "))
    results.errors++

  } else {

    console.log(chalk.green("✓ Clean architecture structure valid"))

  }

}

function table(title, list, column) {

  console.log("")
  console.log(chalk.yellow(title))

  const data = list.map(v => ({
    [column]: v.name,
    Status: v.status,
    Error: v.error || "-"
  }))

  console.table(data)

}

function printSummary() {

  console.log("")
  console.log(chalk.magenta("━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
  console.log(chalk.magenta("SYSTEM SUMMARY"))
  console.log(chalk.magenta("━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))

  console.log("")
  console.log("Events       :", results.events.length)
  console.log("Commands     :", results.commands.length)
  console.log("Services     :", results.services.length)
  console.log("Repositories :", results.repositories.length)

  console.log("")

  if (results.errors === 0) {

    console.log(chalk.green("SYSTEM STATUS : HEALTHY"))

  } else {

    console.log(chalk.red("SYSTEM STATUS : ERRORS"))
    console.log(chalk.red("Total Errors :", results.errors))

  }

}

async function run() {

  await loadChalk()

  console.log("")
  console.log(chalk.magenta("━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))
  console.log(chalk.magenta("4UCK EFARIS SYSTEM DIAGNOSTICS"))
  console.log(chalk.magenta("━━━━━━━━━━━━━━━━━━━━━━━━━━━━"))

  checkEnv()

  checkCommands()
  checkEvents()
  checkServices()
  checkRepositories()

  checkDatabase()
  checkArchitecture()

  table("DISCORD EVENTS", results.events, "Event")
  table("COMMAND REGISTRY", results.commands, "Command")
  table("SERVICES", results.services, "Service")
  table("REPOSITORIES", results.repositories, "Repository")

  printSummary()

}

run()