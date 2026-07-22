const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const AutoNameDatabase = require("../../src/infrastructure/database/AutoNameDatabase");
const ScanQueue = require("../../src/infrastructure/database/repositories/SqliteAutoNameScanQueue");
const Worker = require("../../src/infrastructure/workers/InProcessAutoNameScanWorker");

const GUILD = "10000000000000001";
function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "auto-name-scan-"));
  const filename = path.join(directory, "queue.sqlite");
  const database = new AutoNameDatabase({ filename });
  const queue = new ScanQueue(database, { idFactory: () => options.id || "job-1", clock: options.clock, leaseMs: options.leaseMs ?? 100, maxRetries: options.maxRetries ?? 2 });
  t.after(() => { database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, filename, database, queue };
}
function enqueue(queue, overrides = {}) {
  return queue.enqueueUnique({ guildId: GUILD, actorId: "20000000000000001", createdBy: "20000000000000001",
    missingOnly: true, force: false, dryRun: false, subsetRoleId: null, createdAt: 10, ...overrides });
}

test("partial unique index permits one active scan per guild across handles", (t) => {
  const fx = fixture(t);
  const otherDb = new AutoNameDatabase({ filename: fx.filename });
  const other = new ScanQueue(otherDb, { idFactory: () => "job-2", leaseMs: 100 });
  const first = enqueue(fx.queue);
  const duplicate = enqueue(other);
  assert.equal(first.created, true); assert.equal(duplicate.created, false); assert.equal(duplicate.id, first.id);
  assert.equal(fx.database.connection.prepare("SELECT COUNT(*) AS count FROM auto_name_scan_jobs").get().count, 1);
  otherDb.close();
});

test("multiple processes converge on one active guild scan", async (t) => {
  const fx = fixture(t);
  fx.database.close();
  const dbPath = path.resolve(__dirname, "../../src/infrastructure/database/AutoNameDatabase.js");
  const queuePath = path.resolve(__dirname, "../../src/infrastructure/database/repositories/SqliteAutoNameScanQueue.js");
  const source = `const DB=require(process.argv[1]);const Q=require(process.argv[2]);const db=new DB({filename:process.argv[3]});` +
    `const q=new Q(db,{idFactory:()=>process.argv[4]});const j=q.enqueueUnique({guildId:'${GUILD}',createdBy:'20000000000000001',missingOnly:true,force:false,dryRun:false,createdAt:1});` +
    `db.close();process.stdout.write(j.id);`;
  const ids = await Promise.all(Array.from({ length: 6 }, (_, index) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", source, dbPath, queuePath, fx.filename, `job-${index}`], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = ""; child.stdout.on("data", (chunk) => { out += chunk; }); child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve(out) : reject(new Error(err)));
  })));
  const reopened = new AutoNameDatabase({ filename: fx.filename });
  assert.equal(new Set(ids).size, 1);
  assert.equal(reopened.connection.prepare("SELECT COUNT(*) AS count FROM auto_name_scan_jobs").get().count, 1);
  reopened.close();
});
test("claim heartbeat progress and completion persist cursor and counts", (t) => {
  const { queue } = fixture(t);
  enqueue(queue);
  const job = queue.claimNext({ workerId: "worker-a", now: 20, leaseMs: 100 });
  assert.equal(job.status, "running"); assert.equal(job.createdBy, "20000000000000001");
  assert.equal(queue.heartbeat({ jobId: job.id, workerId: "worker-a", now: 30, leaseMs: 100 }), true);
  const progress = queue.saveProgress({ jobId: job.id, workerId: "worker-a", cursorUserId: "cursor-1",
    totals: { scannedCount: 5, eligibleCount: 4, renamedCount: 3, skippedCount: 1, failedCount: 1 }, now: 40 });
  assert.equal(progress.cursorUserId, "cursor-1"); assert.equal(progress.scannedCount, 5);
  const completed = queue.complete({ jobId: job.id, workerId: "worker-a", now: 50 });
  assert.equal(completed.status, "completed"); assert.equal(completed.leaseOwner, null);
});

test("expired leases resume safely and bounded retry eventually fails", (t) => {
  const { queue } = fixture(t, { maxRetries: 1 });
  enqueue(queue);
  const first = queue.claimNext({ workerId: "worker-a", now: 20, leaseMs: 10 });
  const resumed = queue.claimNext({ workerId: "worker-b", now: 31, leaseMs: 10 });
  assert.equal(resumed.id, first.id); assert.equal(resumed.retryCount, 1); assert.equal(resumed.leaseOwner, "worker-b");
  const exhausted = queue.claimNext({ workerId: "worker-c", now: 42, leaseMs: 10 });
  assert.equal(exhausted, null);
  const status = queue.getStatus({ guildId: GUILD, jobId: first.id });
  assert.equal(status.status, "failed"); assert.equal(status.lastErrorCode, "AUTO_NAME_RETRY_EXHAUSTED");
});

test("lease ownership gates heartbeat progress complete and fail", (t) => {
  const { queue } = fixture(t);
  const job = enqueue(queue); queue.claimNext({ workerId: "owner", now: 20, leaseMs: 100 });
  assert.equal(queue.heartbeat({ jobId: job.id, workerId: "other", now: 21 }), false);
  assert.throws(() => queue.saveProgress({ jobId: job.id, workerId: "other", now: 21 }), (error) => error.code === "AUTO_NAME_LEASE_LOST");
  assert.throws(() => queue.complete({ jobId: job.id, workerId: "other", now: 21 }), (error) => error.code === "AUTO_NAME_LEASE_LOST");
  const retry = queue.fail({ jobId: job.id, workerId: "owner", errorCode: "RATE_LIMIT", retryable: true, now: 22 });
  assert.equal(retry.status, "queued"); assert.equal(retry.retryCount, 1); assert.equal(retry.lastErrorCode, "RATE_LIMIT");
});

test("worker processes one bounded leased batch and passes conservative limits", async () => {
  const calls = [];
  const queue = { async claimNext(input) { calls.push(["claim", input]); return { id: "job", guildId: GUILD }; },
    async fail() { throw new Error("fail should not run"); } };
  const service = { async processLeasedBatch(input) { calls.push(["batch", input]); } };
  const worker = new Worker({ queue, scanService: service, workerId: "worker", batchSize: 20, concurrency: 2 });
  worker.running = true;
  assert.equal(await worker.runOnce(), true);
  assert.equal(calls.filter(([name]) => name === "batch").length, 1);
  assert.equal(calls[1][1].batchSize, 20); assert.equal(calls[1][1].concurrency, 2);
  worker.running = false;
});

test("worker sanitizes failure code and requests only bounded retry state", async () => {
  let failed;
  const queue = { async claimNext() { return { id: "job", guildId: GUILD }; }, async fail(input) { failed = input; } };
  const service = { async processLeasedBatch() { throw Object.assign(new Error("secret stack"), { code: "bad code/token", retryable: true }); } };
  const logs = [];
  const worker = new Worker({ queue, scanService: service, workerId: "worker", telemetry: { info() {}, warn(event, context) { logs.push([event, context]); }, error() {} } });
  worker.running = true; await worker.runOnce(); worker.running = false;
  assert.equal(failed.errorCode, "______________"); assert.equal(failed.retryable, true);
  assert.equal(JSON.stringify(logs).includes("secret stack"), false);
});

test("polling contains claim failures and emits only a sanitized code", async () => {
  let callback;
  const logs = [];
  const worker = new Worker({
    queue: { async claimNext() { throw Object.assign(new Error("secret path SQL"), { code: "bad code/path" }); } },
    scanService: { async processLeasedBatch() {} }, workerId: "worker",
    timers: { setTimeout(fn) { callback = fn; return 1; }, clearTimeout() {} },
    telemetry: { info() {}, warn() {}, error(event, context) { logs.push([event, context]); } },
  });
  worker.start(); callback(); await new Promise((resolve) => setImmediate(resolve)); await worker.stop();
  assert.equal(logs[0][0], "auto_name_worker_poll_failed");
  assert.equal(JSON.stringify(logs).includes("secret path SQL"), false);
});
test("graceful stop cancels polling and waits for the in-flight batch", async () => {
  let timerCallback; let cleared = false; let release;
  const timers = { setTimeout(callback) { timerCallback = callback; return 1; }, clearTimeout(id) { assert.equal(id, 1); cleared = true; } };
  const service = { processLeasedBatch() { return new Promise((resolve) => { release = resolve; }); } };
  const queue = { async claimNext() { return { id: "job", guildId: GUILD }; }, async fail() {} };
  const worker = new Worker({ queue, scanService: service, workerId: "worker", timers });
  worker.start(); assert.equal(typeof timerCallback, "function"); timerCallback();
  await new Promise((resolve) => setImmediate(resolve));
  const stopping = worker.stop(); release(); await stopping;
  assert.equal(worker.running, false); assert.equal(worker.inFlight, null); assert.equal(cleared, false);
  assert.equal(worker.start(), true); await worker.stop(); assert.equal(cleared, true);
});
