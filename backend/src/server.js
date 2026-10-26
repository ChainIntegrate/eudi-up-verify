// Entry point: binds to 127.0.0.1 only (nginx in front). Refuses to start if the port is busy.
import { chmodSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAdmin } from "./admin.js";
import { createApp } from "./app.js";
import { createBadgeReader, createMinter } from "./chain.js";
import { loadTrustStore } from "./cie/trust.js";
import { createCieFlow, failInterrupted } from "./cieFlow.js";
import { loadConfig } from "./config.js";
import { kvGet, kvSet, openDb } from "./db.js";
import { runIndexer } from "./indexer.js";
import { createMailer, flushNotifications, notify } from "./notify.js";
import { runCleanup, runRevocationCheck } from "./revocation.js";
import { processInvalidations, reconcileMints } from "./mints.js";
import { createSerialQueue } from "./queue.js";
import { checkSigner, createSigner, socketTransport } from "./signer.js";
import { createSubjectRequests } from "./subject.js";
import { createProvider, createUpChecker } from "./up.js";

// UCL-08: files created by this process are private (database, -wal/-shm, backups made in-process)
process.umask(0o077);
const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile) && (statSync(envFile).mode & 0o077) !== 0) {
  console.error("backend/.env is readable by other users: run `chmod 600 backend/.env`");
  process.exit(1);
}

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
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

// UCL-08: the secrets are in the signer process. The site starts anyway (verify pages, admin page); new CIE files
// are refused until the signer has answered and passed the checks (protocol, contract, UNIQ_PEPPER check value,
// attester = the contract's attester or zero after an emergency stop). Retried every minute while not ready.
const signer = createSigner(socketTransport(cfg.signerSocket));
const signerState = { ready: false, address: null, error: "NOT_CHECKED" };
const signerProblem = (code, text) => {
  if (signerState.error === code) return;
  signerState.error = code;
  console.error(`signer: ${code}`);
  if (code !== "SIGNER_UNAVAILABLE") notify(db, { kind: "signer", severity: "problem", subject: `signer: ${code}`, body: text });
};
async function connectSigner() {
  try {
    const { address } = await checkSigner(signer, {
      contract: cfg.deployment.address,
      chainId: cfg.deployment.chainId,
      kvGet: (k) => kvGet(db, k),
      kvSet: (k, v) => kvSet(db, k, v),
    });
    const onChainAttester = await badge.attester();
    if (/^0x0{40}$/i.test(onChainAttester)) {
      // emergency stop (admin page): every mint fails its simulation until the attester is restored
      console.warn("Minting is STOPPED: the contract's attester is zero. Restore it from the admin page.");
    } else if (onChainAttester.toLowerCase() !== address.toLowerCase()) {
      return signerProblem("ATTESTER_MISMATCH", `The signer's key ${address} is not the contract's attester (${onChainAttester}). New CIE files are refused.`);
    }
    // a CERT_REF_KEY copied wrong: stored certificate references would no longer decrypt (revocation recheck lost)
    const sample = db.prepare("SELECT cert_ref_enc FROM links WHERE cert_ref_enc IS NOT NULL LIMIT 1").get();
    if (sample) {
      try {
        await signer.decryptCertRef(sample.cert_ref_enc);
      } catch (e) {
        if (e?.code === "DECRYPT_FAILED") {
          return signerProblem("CERT_REF_KEY_MISMATCH", "The signer's CERT_REF_KEY does not decrypt the stored certificate references. New CIE files are refused: put the original CERT_REF_KEY in the signer's env file and restart both.");
        }
        throw e;
      }
    }
    Object.assign(signerState, { ready: true, address, error: null });
    console.log(`signer ready: attester ${address}`);
  } catch (e) {
    const code = e?.code ?? "SIGNER_ERROR";
    if (code === "PEPPER_MISMATCH") {
      // never accepted later: a different UNIQ_PEPPER would silently break "one person, one primary UP"
      signerProblem(code, "The signer's UNIQ_PEPPER differs from the one used so far (check value stored at the first start). New CIE files are refused: put the original UNIQ_PEPPER in the signer's env file and restart both.");
      signerState.fatal = true;
    } else {
      signerProblem(code, `The signer does not pass the start-up checks (${code}). New CIE files are refused.`);
    }
  }
}
await connectSigner();
const minter = createMinter(provider, cfg.deployment.address, signer, () => signerState.address);
const trust = loadTrustStore(cfg.trustDir, cfg.cieRootSha256);
const interrupted = failInterrupted(db);
if (interrupted) console.warn(`${interrupted} statement(s) interrupted by the previous shutdown marked as failed`);

const queue = createSerialQueue();
const cieFlow = createCieFlow({ db, cfg, trust, signer, signerReady: () => signerState.ready, badge, minter, queue });
const healthInfo = () => ({
  indexer: kvGet(db, "indexer"),
  queue: queue.size,
  signer: { ready: signerState.ready, error: signerState.error, address: signerState.address },
});
const upChecker = createUpChecker(provider);
const admin = createAdmin({ db, cfg, upChecker, chain: badge, minterAddress: () => signerState.address, healthInfo, metadataFile: cfg.metadataFile });
const subject = createSubjectRequests({ db, cfg, upChecker });
const app = createApp({ db, cfg, upChecker, cieFlow, badge, admin, subject, healthInfo });

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
every("revocation", DAY, () => runRevocationCheck({ db, trust, signer, queue, minter, badge }), 10 * 60_000);
// the signer: retried while not ready; when ready, a missing answer marks it unavailable until it answers again
every("signer", 60_000, async () => {
  if (signerState.fatal) return;
  if (!signerState.ready) return connectSigner();
  try {
    await signer.hello();
  } catch {
    signerState.ready = false;
    signerProblem("SIGNER_UNAVAILABLE", "");
  }
}, 60_000);
// UCL-04 / UCL-20: close mints left open (timeout, restart) and send pending invalidations; first run at start-up
every("chain", 60_000, () =>
  queue.push(async () => {
    await reconcileMints({ db, provider, badge });
    await processInvalidations({ db, minter, badge });
  }));
every("cleanup", DAY, () => runCleanup(db), 15 * 60_000);
const server = app.listen(cfg.port, "127.0.0.1", () => {
  console.log(`up-cie-link backend on 127.0.0.1:${cfg.port} (${cfg.network}, contract ${cfg.deployment.address})`);
  console.log(`attester ${signerState.address ?? "(signer not ready)"}, trust store: ${trust.roots.length} root(s), ${trust.intermediates.length} intermediate(s)`);
});
server.on("error", (e) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${cfg.port} is already in use: choose another PORT` : `Server error: ${e.code}`);
  process.exit(1);
});

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
