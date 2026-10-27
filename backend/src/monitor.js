// Hourly monitor, separate from the backend process (so it notices when the backend is down).
// Read-only: it never holds a signing role. Same scheme as the Cross_Chain relayer monitor:
// email only when the set of findings changes, a reminder every 24 h while problems remain, "all clear" when fixed,
// plus one daily summary (counts and UP addresses only, never personal data).
//
//   node src/monitor.js              run once (schedule it hourly)
//   node src/monitor.js --dry-run    print findings and summary, send nothing, do not touch the state
//   node src/monitor.js --test-email send a test email
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { X509Certificate } from "node:crypto";
import Database from "better-sqlite3";
import { JsonRpcProvider, formatEther, parseEther } from "ethers";
import { createBadgeReader } from "./chain.js";
import { loadDeployment } from "./config.js";
import { createMailer } from "./notify.js";
import { createSigner, socketTransport } from "./signer.js";

const HOUR = 3_600_000;

/** @returns {Promise<Array<{id: string, level: "problem"|"todo", text: string}>>} */
export async function collectFindings({ cfg, provider, db, fetchHealth, fetchSignerStatus, now }) {
  const findings = [];
  const add = (id, level, text) => findings.push({ id, level, text });

  // backend process
  // two attempts, as for the RPC: a restart (pm2 reload) takes a few seconds and must not raise an alarm
  let health = null;
  let healthError = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      health = await fetchHealth();
      healthError = false;
      break;
    } catch {
      healthError = true;
      if (attempt === 0) await new Promise((r) => setTimeout(r, cfg.healthRetryDelayMs ?? 15_000));
    }
  }
  if (healthError) add("backend_down", "problem", `backend not answering on 127.0.0.1:${cfg.port}`);
  else if (!health?.ok) add("backend_unhealthy", "problem", "backend /api/health does not report ok");
  // UCL-08: without the signer no CIE file is verified and nothing is minted
  else if (health.signer && !health.signer.ready) add("signer_not_ready", "problem", `signer not ready (${health.signer.error}): new CIE files are refused`);
  // UCL-47: the signer's own counters, read on its socket (an alarm that does not depend on the backend)
  if (fetchSignerStatus) {
    let st = null;
    try {
      st = await fetchSignerStatus();
    } catch {
      add("signer_down", "problem", "signer not answering on its socket");
    }
    const refused = Object.entries(st?.refusedLastDay ?? {}).filter(([, n]) => n > 0);
    if (refused.length) {
      add("signer_refusals", "problem", `signer rate limits hit in the last 24 hours (${refused.map(([k, n]) => `${k}: ${n}`).join(", ")}): real traffic → raise the limits in /etc/up-cie-link/signer.env; otherwise check the server`);
    }
  }
  if (health?.indexer?.at && now - health.indexer.at > 15 * 60_000) {
    add("indexer_stuck", "problem", `event indexer has not run for ${Math.round((now - health.indexer.at) / 60_000)} minutes`);
  }

  // chain
  let chainOk = false;
  for (let attempt = 0; attempt < 2 && !chainOk; attempt++) {
    try {
      const id = Number(await provider.send("eth_chainId", []));
      if (id !== cfg.deployment.chainId) add("rpc_wrong_chain", "problem", `RPC is on chain ${id}, expected ${cfg.deployment.chainId}`);
      chainOk = true;
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, cfg.retryDelayMs ?? 5000));
    }
  }
  if (!chainOk) add("rpc_down", "problem", "RPC not reachable");

  if (chainOk && !findings.some((f) => f.id === "rpc_wrong_chain")) {
    const badge = createBadgeReader(provider, cfg.deployment.address);
    try {
      const onChain = (await badge.attester()).toLowerCase();
      if (onChain === "0x0000000000000000000000000000000000000000") {
        add("attester_zero", "problem", "attester is zero on-chain: new badges are stopped (emergency stop)");
      } else if (onChain !== cfg.attesterAddress.toLowerCase()) {
        add("attester_mismatch", "problem", `on-chain attester ${onChain} differs from the configured key ${cfg.attesterAddress}`);
      }
      const balance = await provider.getBalance(cfg.attesterAddress);
      if (balance < cfg.minAttesterBalance) {
        add("attester_low_balance", "problem",
          `attester ${cfg.attesterAddress} has ${formatEther(balance)} LYX, below ${formatEther(cfg.minAttesterBalance)}: top it up or minting will stop`);
      }
    } catch {
      add("chain_read_failed", "problem", "could not read the contract or the attester balance");
    }
  }

  // backups
  const statusFile = cfg.backupDir ? path.join(cfg.backupDir, "last-backup.json") : null;
  if (!statusFile || !existsSync(statusFile)) {
    add("backup_missing", "problem", "no backup found (last-backup.json missing)");
  } else {
    const last = JSON.parse(readFileSync(statusFile, "utf8"));
    const age = now - Date.parse(last.at);
    if (age > 36 * HOUR) add("backup_old", "problem", `last backup is ${Math.round(age / HOUR)} hours old (${last.file})`);
  }

  // CIE CA certificates in the trust store
  if (cfg.trustDir && existsSync(cfg.trustDir)) {
    for (const f of readdirSync(cfg.trustDir).filter((n) => /\.(pem|cer|crt|der)$/i.test(n))) {
      try {
        const x = new X509Certificate(readFileSync(path.join(cfg.trustDir, f)));
        const left = Date.parse(x.validTo) - now;
        if (left < 0) add(`ca_expired_${f}`, "problem", `CA certificate ${f} expired on ${x.validTo}`);
        else if (left < 60 * 24 * HOUR) add(`ca_expiring_${f}`, "todo", `CA certificate ${f} expires on ${x.validTo}: add the new one to the trust store`);
      } catch {
        add(`ca_unreadable_${f}`, "todo", `trust store file ${f} is not a readable certificate`);
      }
    }
  }

  // database-side signals
  if (db) {
    const stuck = db.prepare("SELECT COUNT(*) n FROM notifications WHERE sent_at IS NULL AND ts < ?").get(now - 30 * 60_000).n;
    if (stuck > 0) add("mail_stuck", "problem", `${stuck} notification(s) not sent by the backend for more than 30 minutes`);
    const kv = (key) => {
      const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
      return row ? JSON.parse(row.value) : null;
    };
    const days = kv("ocsp_unavailable")?.days ?? 0;
    if (days >= 3) add("ocsp_unavailable", "problem", `OCSP unreachable during the revocation recheck for ${days} days`);

    // UCL-06: the revocation recheck must run and give usable answers
    const validLinks = db.prepare("SELECT COUNT(*) n FROM links WHERE status = 'valid' AND expires_at > ?").get(now).n;
    const rev = kv("revocation");
    if (validLinks > 0 && (!rev || now - rev.at > 36 * HOUR)) {
      add("revocation_stale", "problem", rev ? `revocation recheck last ran ${Math.round((now - rev.at) / HOUR)} hours ago` : "revocation recheck never ran");
    }
    if (rev?.errors > 0) add("revocation_errors", "problem", `last revocation recheck: ${rev.errors} of ${rev.checked} certificates without a usable OCSP answer`);

    // UCL-01 / UCL-22: minting pipeline
    const openMints = db.prepare("SELECT COUNT(*) n FROM mints WHERE created_at < ?").get(now - 15 * 60_000).n;
    if (openMints > 0) add("mints_open", "problem", `${openMints} mint(s) open for more than 15 minutes (transaction pending or not confirmed)`);
    const stuckStatements = db.prepare("SELECT COUNT(*) n FROM statements WHERE status IN ('verifying','queued') AND issued_at < ?").get(now - 30 * 60_000).n;
    if (stuckStatements > 0) add("queue_stuck", "problem", `${stuckStatements} statement(s) still verifying or queued 30 minutes after creation: the queue may be blocked`);
    const failingInvalidations = db.prepare("SELECT COUNT(*) n FROM pending_invalidations WHERE attempts >= 3").get().n;
    if (failingInvalidations > 0) add("invalidations_failing", "problem", `${failingInvalidations} on-chain invalidation(s) failed at least 3 times`);
    const mintFailures = db.prepare("SELECT COUNT(*) n FROM audit WHERE event = 'mint_failed' AND ts >= ?").get(now - 24 * HOUR).n;
    if (mintFailures >= 3) add("mint_failures", "problem", `${mintFailures} minting failures in the last 24 hours`);
  }
  return findings;
}

export function dailySummary({ db, now, attesterBalance, backupStatus }) {
  const since = now - 24 * HOUR;
  const count = (event, detail) =>
    detail === undefined
      ? db.prepare("SELECT COUNT(*) n FROM audit WHERE event = ? AND ts >= ?").get(event, since).n
      : db.prepare("SELECT COUNT(*) n FROM audit WHERE event = ? AND detail = ? AND ts >= ?").get(event, detail, since).n;
  const grouped = (event) =>
    db.prepare("SELECT detail, COUNT(*) n FROM audit WHERE event = ? AND ts >= ? GROUP BY detail ORDER BY n DESC").all(event, since);
  const active = db.prepare("SELECT is_primary, COUNT(*) n FROM links WHERE status = 'valid' AND expires_at > ? GROUP BY is_primary").all(now);
  const activeOf = (p) => active.find((r) => r.is_primary === p)?.n ?? 0;
  const lines = [
    "Last 24 hours",
    `  statements created:        ${count("statement_created")}`,
    `  UP signatures accepted:    ${count("up_signed")}`,
    `  CIE signatures verified:   ${count("cie_verified")}`,
    `  badges minted (primary):   ${count("attested", "primary")}`,
    `  badges minted (additional):${count("attested", "additional")}`,
    `  minting failures:          ${count("mint_failed")}`,
    `  renounced / revoked:       ${count("renounced")} / ${count("revoked")}`,
    `  revocation recheck:        ${(() => {
      const r = db.prepare("SELECT value FROM kv WHERE key = 'revocation'").get();
      if (!r) return "not run yet";
      const v = JSON.parse(r.value);
      return `${new Date(v.at).toISOString()}: ${v.checked} checked, ${v.good} good, ${v.revoked} revoked, ${v.unavailable} unavailable, ${v.errors} errors`;
    })()}`,
    "  CIE refused by reason:     " + (grouped("cie_rejected").map((r) => `${r.detail} ${r.n}`).join(", ") || "none"),
    "  links refused by reason:   " + (grouped("link_refused").map((r) => `${r.detail} ${r.n}`).join(", ") || "none"),
    "",
    "Now",
    `  active badges:             ${activeOf(1)} primary, ${activeOf(0)} additional`,
    `  attester balance:          ${attesterBalance === null ? "unknown" : `${formatEther(attesterBalance)} LYX`}`,
    `  last backup:               ${backupStatus ? `${backupStatus.at} (${backupStatus.file})` : "none"}`,
  ];
  return lines.join("\n");
}

function render(findings) {
  const problems = findings.filter((f) => f.level === "problem");
  const todo = findings.filter((f) => f.level === "todo");
  const out = [];
  if (problems.length) out.push("PROBLEMS (act now)", ...problems.map((f) => `  - ${f.text}`), "");
  if (todo.length) out.push("TO DO", ...todo.map((f) => `  - ${f.text}`), "");
  return out.join("\n");
}

/**
 * One monitor run. State (last findings, last email, last summary) lives in `stateFile`.
 * @returns {Promise<{findings, sent: string[]}>}
 */
export async function runMonitor({ cfg, provider, db, fetchHealth, fetchSignerStatus, mailer, stateFile, now = Date.now(), dryRun = false }) {
  const findings = await collectFindings({ cfg, provider, db, fetchHealth, fetchSignerStatus, now });
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { ids: [], lastMail: 0, lastSummaryDay: null };
  const ids = findings.map((f) => f.id).sort();
  const changed = JSON.stringify(ids) !== JSON.stringify(state.ids);
  const sent = [];
  const label = `up-cie-link ${cfg.network}`;

  // A failed e-mail never stops the monitor and is never recorded as sent: the state is left as it was,
  // so the same message is tried again at the next run.
  const mailErrors = [];
  const send = async (subject, text) => {
    sent.push(subject);
    if (dryRun || !mailer) return true;
    try {
      await mailer.send(subject, text);
      return true;
    } catch (e) {
      mailErrors.push(`${e?.code ?? "error"} ${e?.hostname ?? ""}`.trim());
      return false;
    }
  };

  let delivered = true;
  if (changed && ids.length > 0) {
    delivered = await send(`[PROBLEM] ${label}: ${findings.length} finding(s)`, render(findings));
  } else if (changed && ids.length === 0 && state.ids.length > 0) {
    delivered = await send(`[OK] ${label}: all clear`, "All previously reported findings are resolved.");
  } else if (!changed && ids.length > 0 && now - state.lastMail >= 24 * HOUR) {
    delivered = await send(`[REMINDER] ${label}: ${findings.length} finding(s) still open`, render(findings));
  } else {
    delivered = null; // nothing to send
  }
  if (delivered) state.lastMail = now;
  if (delivered !== false) state.ids = ids;

  const day = new Date(now).toISOString().slice(0, 10);
  if (db && state.lastSummaryDay !== day && new Date(now).getUTCHours() >= (cfg.digestHourUtc ?? 6)) {
    let balance = null;
    try {
      balance = await provider.getBalance(cfg.attesterAddress);
    } catch {}
    const statusFile = cfg.backupDir ? path.join(cfg.backupDir, "last-backup.json") : null;
    const backupStatus = statusFile && existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, "utf8")) : null;
    if (await send(`[INFO] ${label}: daily summary ${day}`, dailySummary({ db, now, attesterBalance: balance, backupStatus }))) state.lastSummaryDay = day;
  }

  if (!dryRun) writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  return { findings, sent, mailErrors };
}

export function monitorConfig(env = process.env) {
  const network = env.NETWORK;
  const deploymentsDir = env.DEPLOYMENTS_DIR || fileURLToPath(new URL("../../contracts/deployments", import.meta.url));
  // UCL-22: the monitor never reads the attester's private key, only its address
  const attesterAddress = env.ATTESTER_ADDRESS;
  if (!network || !env.RPC_URL || !env.PORT || !env.DB_PATH || !attesterAddress) {
    throw new Error("monitor needs NETWORK, RPC_URL, PORT, DB_PATH and ATTESTER_ADDRESS (see monitor.env.example)");
  }
  return {
    network,
    deployment: loadDeployment(network, deploymentsDir),
    rpcUrl: env.RPC_URL,
    port: Number(env.PORT),
    dbPath: env.DB_PATH,
    backupDir: env.BACKUP_DIR || null,
    trustDir: env.TRUST_DIR || fileURLToPath(new URL("../trust", import.meta.url)),
    attesterAddress,
    minAttesterBalance: parseEther(env.MIN_ATTESTER_BALANCE || "1"),
    digestHourUtc: Number(env.DIGEST_HOUR_UTC || 6),
    stateFile: env.MONITOR_STATE_FILE || path.join(path.dirname(env.DB_PATH), "monitor-state.json"),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // its own configuration file, without secrets other than SMTP (UCL-22); never backend/.env
  const envFile = process.env.MONITOR_ENV_FILE || fileURLToPath(new URL("../monitor.env", import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const args = new Set(process.argv.slice(2));
  const mailer = createMailer();
  if (args.has("--test-email")) {
    if (!mailer) {
      console.error("monitor: SMTP_HOST and NOTIFICATION_EMAIL are required");
      process.exit(2);
    }
    try {
      await mailer.send("[TEST] up-cie-link monitor", "Test email from the up-cie-link monitor.");
    } catch (e) {
      console.error(`test email FAILED: ${e?.code ?? "error"}${e?.hostname ? ` (host ${e.hostname})` : ""}${e?.responseCode ? ` (SMTP ${e.responseCode})` : ""}`);
      process.exit(1);
    }
    console.log(`test email sent to the configured address`);
    process.exit(0);
  }
  let cfg;
  try {
    cfg = monitorConfig();
  } catch (e) {
    console.error(`monitor: ${e.message}`);
    process.exit(2);
  }
  const provider = new JsonRpcProvider(cfg.rpcUrl, cfg.deployment.chainId, { staticNetwork: true });
  const db = existsSync(cfg.dbPath) ? new Database(cfg.dbPath, { readonly: true, fileMustExist: true }) : null;
  const fetchHealth = async () => (await fetch(`http://127.0.0.1:${cfg.port}/api/health`, { signal: AbortSignal.timeout(10_000) })).json();
  const signer = createSigner(socketTransport(process.env.SIGNER_SOCKET || "/run/up-cie-link-signer/signer.sock", { timeoutMs: 5000 }));
  const { findings, sent, mailErrors } = await runMonitor({
    cfg,
    provider,
    db,
    fetchHealth,
    fetchSignerStatus: () => signer.status(),
    mailer,
    stateFile: cfg.stateFile,
    dryRun: args.has("--dry-run"),
  });
  console.log(findings.length ? render(findings) : "no findings");
  if (sent.length) console.log(`${args.has("--dry-run") ? "would send" : "sent"}: ${sent.join(" | ")}`);
  if (!mailer && !args.has("--dry-run")) console.warn("SMTP not configured: nothing was emailed");
  if (mailErrors.length) console.error(`e-mail NOT sent (${mailErrors.join("; ")}): retried at the next run`);
  db?.close();
  provider.destroy();
  if (mailErrors.length) process.exitCode = 1; // visible in systemctl / journalctl
}
