// Entry point: binds to 127.0.0.1 only (nginx in front). Refuses to start if the port is busy.
import { chmodSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAdmin } from "./admin.js";
import { createApp } from "./app.js";
import { createBadgeReader, createMinter } from "./chain.js";
import { loadTrustStore } from "./cie/trust.js";
import { createCieFlow, failInterrupted } from "./cieFlow.js";
import { loadConfig } from "./config.js";
import { kvGet, openDb } from "./db.js";
import { runIndexer } from "./indexer.js";
import { createMailer, flushNotifications } from "./notify.js";
import { runCleanup, runRevocationCheck } from "./revocation.js";
import { processInvalidations, reconcileMints } from "./mints.js";
import { createSerialQueue } from "./queue.js";
import { createProvider, createUpChecker } from "./up.js";

// UCL-08: files created by this process are private (database, -wal/-shm, backups made in-process)
process.umask(0o077);
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile) && (statSync(envFile).mode & 0o077) !== 0) {
  console.error("backend/.env is readable by other users: run `chmod 600 backend/.env` (it holds the secrets)");
  process.exit(1);
}

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
for (const f of [cfg.dbPath, `${cfg.dbPath}-wal`, `${cfg.dbPath}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
const provider = createProvider(cfg.rpcUrl, cfg.deployment.chainId);

// Ask the RPC itself: the provider uses a static network and would not detect a wrong endpoint.
let rpcChainId;
try {
  rpcChainId = Number(await provider.send("eth_chainId", []));
} catch {
  console.error("RPC not reachable");
  process.exit(1);
}
if (rpcChainId !== cfg.deployment.chainId) {
  console.error(`RPC chainId ${rpcChainId} does not match ${cfg.network} (${cfg.deployment.chainId})`);
  process.exit(1);
}

const badge = createBadgeReader(provider, cfg.deployment.address);
const minter = createMinter(provider, cfg.deployment.address, cfg.attesterPrivateKey);
const onChainAttester = await badge.attester();
if (onChainAttester.toLowerCase() !== minter.address.toLowerCase()) {
  console.error(`ATTESTER_PRIVATE_KEY is not the contract's attester (${onChainAttester})`);
  process.exit(1);
}
const trust = loadTrustStore(cfg.trustDir, cfg.cieRootSha256);
const interrupted = failInterrupted(db);
if (interrupted) console.warn(`${interrupted} statement(s) interrupted by the previous shutdown marked as failed`);

const queue = createSerialQueue();
const cieFlow = createCieFlow({ db, cfg, trust, pepper: cfg.uniqPepper, certRefKey: cfg.certRefKey, badge, minter, queue });
const healthInfo = () => ({ indexer: kvGet(db, "indexer"), queue: queue.size });
const upChecker = createUpChecker(provider);
const admin = createAdmin({ db, cfg, upChecker, chain: badge, minterAddress: minter.address, healthInfo, metadataFile: cfg.metadataFile });
const app = createApp({ db, cfg, upChecker, cieFlow, badge, admin, healthInfo });

// --- periodic jobs (errors are counted, never crash the process; codes only in the logs) ---
const mailer = createMailer();
if (!mailer) console.warn("SMTP not configured: notifications stay queued in the database");
const every = (name, ms, fn, firstDelayMs = 0) => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      console.error(`[job ${name}] ${e?.code ?? e?.name ?? "error"}`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => {
    tick();
    setInterval(tick, ms).unref();
  }, firstDelayMs).unref();
};
const DAY = 86_400_000;
every("indexer", 60_000, () =>
  runIndexer({ db, provider, address: cfg.deployment.address, deployBlock: cfg.deployment.deployBlock, maxRange: cfg.indexerMaxRange }));
every("notifications", 60_000, () => flushNotifications(db, mailer, { label: `up-cie-link ${cfg.network}` }), 5_000);
every("revocation", DAY, () => runRevocationCheck({ db, trust, certRefKey: cfg.certRefKey, queue, minter, badge }), 10 * 60_000);
// UCL-04 / UCL-20: close mints left open (timeout, restart) and send pending invalidations; first run at start-up
every("chain", 60_000, () =>
  queue.push(async () => {
    await reconcileMints({ db, provider, badge });
    await processInvalidations({ db, minter, badge });
  }));
every("cleanup", DAY, () => runCleanup(db), 15 * 60_000);
const server = app.listen(cfg.port, "127.0.0.1", () => {
  console.log(`up-cie-link backend on 127.0.0.1:${cfg.port} (${cfg.network}, contract ${cfg.deployment.address})`);
  console.log(`attester ${minter.address}, trust store: ${trust.roots.length} root(s), ${trust.intermediates.length} intermediate(s)`);
});
server.on("error", (e) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${cfg.port} is already in use: choose another PORT` : `Server error: ${e.code}`);
  process.exit(1);
});

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
