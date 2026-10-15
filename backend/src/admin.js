// Admin API (docs/03-frontend.md §6, decisions A1-A5 of 2026-10-15).
// A1: only the contract owner (a UP, read on-chain) can log in, by signing a one-time challenge (ERC-1271, 5 minutes);
//     the session is a random token in an HttpOnly, SameSite=Strict cookie, kept in memory for 30 minutes.
// A3: the backend never holds owner keys: it only prepares calldata, which the owner UP sends from the browser.
// A5: every admin action is written to the audit log and emailed.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import express from "express";
import { Interface, concat, encodeBytes32String, formatEther, getAddress, isAddress, keccak256, toUtf8Bytes } from "ethers";
import { audit, kvGet } from "./db.js";
import { notify } from "./notify.js";

export const LSP4_METADATA_KEY = "0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e";
const KECCAK256_UTF8 = "0x6f357c6a";
const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 30 * 60_000;
const COOKIE = "ucl_admin";
const ZERO = "0x0000000000000000000000000000000000000000";

const OWNER_IFACE = new Interface([
  "function approveException(bytes32 ticket, uint8 maxUps)",
  "function revoke(address up, bytes32 reason)",
  "function reinstate(address up)",
  "function setAttester(address newAttester)",
  "function setData(bytes32 dataKey, bytes dataValue)",
]);
export const REVOKE_REASONS = ["REVOKED", "ABUSE"];

export class AdminError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const hashToken = (t) => createHash("sha256").update(t).digest();

/** VerifiableURI of the badge metadata JSON served by the site (same bytes as on disk). */
export function metadataValue(json, url) {
  return concat(["0x0000", KECCAK256_UTF8, "0x0020", keccak256(toUtf8Bytes(json)), toUtf8Bytes(url)]);
}

/**
 * @param deps {{db, cfg, upChecker, chain: {owner(), attester(), getData(key), getAttestation(up), exceptionOf(t),
 *   balance(addr)}, minterAddress?: string, healthInfo?: Function, metadataFile?: string, clock?: () => number}}
 */
export function createAdmin({ db, cfg, upChecker, chain, minterAddress = null, healthInfo = () => ({}), metadataFile, clock = Date.now }) {
  const challenges = new Map(); // id -> {up, text, expires}
  const sessions = new Map(); // sha256(token) -> {up, expires}
  const contract = cfg.deployment.address;
  const prune = (now) => {
    for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
    for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
  };

  const requireOwner = async (up) => {
    const owner = getAddress(await chain.owner());
    if (getAddress(up) !== owner) throw new AdminError(403, "NOT_OWNER");
    return owner;
  };

  function challengeText(up, nonce, issued, expires) {
    return [
      "up-cie-link admin login v1",
      `Origin: ${cfg.statementOrigin ?? cfg.publicOrigin}`,
      `Chain-Id: ${cfg.deployment.chainId}`,
      `Contract: ${contract}`,
      `Universal-Profile: ${up}`,
      `Nonce: ${nonce}`,
      `Issued-At: ${iso(issued)}`,
      `Expires-At: ${iso(expires)}`,
      "Sign only to log in to the UP CIE Link admin page. / Firma solo per accedere alla pagina admin di UP CIE Link.",
    ].join("\n");
  }

  async function createChallenge(upInput) {
    if (typeof upInput !== "string" || !isAddress(upInput)) throw new AdminError(400, "INVALID_UP");
    const up = await requireOwner(upInput);
    const now = clock();
    prune(now);
    if (challenges.size > 1000) throw new AdminError(429, "RATE_LIMITED");
    const id = randomBytes(16).toString("hex");
    const text = challengeText(up, randomBytes(16).toString("base64url"), now, now + CHALLENGE_TTL_MS);
    challenges.set(id, { up, text, expires: now + CHALLENGE_TTL_MS });
    return { id, text };
  }

  async function login(id, signature) {
    const c = typeof id === "string" ? challenges.get(id) : null;
    if (c) challenges.delete(id); // single use, whatever the outcome
    if (!c || c.expires < clock()) throw new AdminError(401, "CHALLENGE_EXPIRED");
    if (typeof signature !== "string" || !(await upChecker.isValidUpSignature(c.up, c.text, signature))) {
      throw new AdminError(401, "INVALID_SIGNATURE");
    }
    await requireOwner(c.up); // still the owner now
    const token = randomBytes(32).toString("base64url");
    sessions.set(hashToken(token).toString("hex"), { up: c.up, expires: clock() + SESSION_TTL_MS });
    audit(db, "admin_login", { up: c.up }, clock());
    return { token, up: c.up, expiresAt: iso(clock() + SESSION_TTL_MS) };
  }

  function session(token) {
    if (typeof token !== "string" || !token) return null;
    const key = hashToken(token).toString("hex");
    const s = sessions.get(key);
    if (!s || s.expires < clock()) {
      sessions.delete(key);
      return null;
    }
    return s;
  }

  function readMetadataFile() {
    if (!metadataFile || !existsSync(metadataFile)) return null;
    return readFileSync(metadataFile, "utf8");
  }
  const metadataUrl = () => `${cfg.publicOrigin.replace(/\/$/, "")}/metadata/badge.json`;

  async function status() {
    const now = clock();
    const [owner, attester, onChainMetadata] = await Promise.all([chain.owner(), chain.attester(), chain.getData(LSP4_METADATA_KEY)]);
    let balance = null;
    try {
      balance = formatEther(await chain.balance(attester === ZERO ? (minterAddress ?? ZERO) : attester));
    } catch { /* unknown */ }
    const json = readMetadataFile();
    const expected = json ? metadataValue(json, metadataUrl()) : null;
    const count = (sql, ...a) => db.prepare(sql).get(...a).n;
    const backupFile = cfg.backupDir ? `${cfg.backupDir}/last-backup.json` : null;
    return {
      network: cfg.network,
      chainId: cfg.deployment.chainId,
      contract,
      deployBlock: cfg.deployment.deployBlock,
      owner: getAddress(owner),
      attester: getAddress(attester),
      configuredAttester: minterAddress,
      mintingStopped: attester === ZERO,
      attesterBalance: balance,
      indexer: kvGet(db, "indexer"),
      revocation: kvGet(db, "revocation"),
      queue: healthInfo().queue ?? null,
      openMints: count("SELECT COUNT(*) n FROM mints"),
      pendingInvalidations: count("SELECT COUNT(*) n FROM pending_invalidations"),
      unsentNotifications: count("SELECT COUNT(*) n FROM notifications WHERE sent_at IS NULL"),
      activeBadges: {
        primary: count("SELECT COUNT(*) n FROM links WHERE status = 'valid' AND expires_at > ? AND is_primary = 1", now),
        additional: count("SELECT COUNT(*) n FROM links WHERE status = 'valid' AND expires_at > ? AND is_primary = 0", now),
      },
      lastBackup: backupFile && existsSync(backupFile) ? JSON.parse(readFileSync(backupFile, "utf8")).at : null,
      metadata: { url: metadataUrl(), onChain: onChainMetadata, expected, upToDate: expected !== null && onChainMetadata === expected },
    };
  }

  async function exceptions() {
    const rows = db
      .prepare(
        `SELECT r.ticket, r.status, r.created_at,
                (SELECT s.up FROM statements s WHERE s.exception_ticket = r.ticket ORDER BY s.issued_at DESC LIMIT 1) AS up
         FROM exception_requests r WHERE r.status IN ('pending','approved') ORDER BY r.created_at DESC LIMIT 200`,
      )
      .all();
    const out = [];
    for (const r of rows) out.push({ ticket: r.ticket, status: r.status, up: r.up, createdAt: iso(r.created_at), maxUps: Number(await chain.exceptionOf(r.ticket)) });
    return out;
  }

  function rejectException(ticket, by) {
    const changed = db.prepare("UPDATE exception_requests SET status = 'rejected' WHERE ticket = ? AND status = 'pending'").run(ticket).changes;
    if (!changed) throw new AdminError(404, "NOT_FOUND");
    logAction(by, "exception_rejected", { detail: ticket });
  }

  async function badge(upInput) {
    if (typeof upInput !== "string" || !isAddress(upInput)) throw new AdminError(400, "INVALID_UP");
    const up = getAddress(upInput);
    const a = await chain.getAttestation(up);
    const link = db.prepare("SELECT status, is_primary, verified_at, expires_at, last_ocsp_status FROM links WHERE up = ?").get(up);
    const STATUS = ["none", "valid", "invalidated", "revoked"];
    return {
      up,
      onChain: {
        status: STATUS[Number(a.status)] ?? "unknown",
        primary: a.primary,
        verifiedAt: Number(a.verifiedAt) ? iso(Number(a.verifiedAt) * 1000) : null,
        expiresAt: Number(a.expiresAt) ? iso(Number(a.expiresAt) * 1000) : null,
      },
      local: link
        ? { status: link.status, primary: link.is_primary === 1, lastRevocationCheck: link.last_ocsp_status }
        : null,
    };
  }

  /** A3: calldata for the owner UP to send to the contract. Validated here, signed in the browser. */
  async function buildTx(action, args = {}) {
    let data;
    let summary;
    switch (action) {
      case "approveException": {
        const n = Number(args.maxUps);
        if (!/^0x[0-9a-fA-F]{64}$/.test(args.ticket ?? "") || !Number.isInteger(n) || n < 0 || n > 20) throw new AdminError(400, "INVALID_ARGS");
        data = OWNER_IFACE.encodeFunctionData("approveException", [args.ticket, n]);
        summary = n === 0 ? `withdraw exception ${args.ticket}` : `approve exception ${args.ticket} for ${n} UPs`;
        break;
      }
      case "revoke": {
        if (!isAddress(args.up ?? "") || !REVOKE_REASONS.includes(args.reason)) throw new AdminError(400, "INVALID_ARGS");
        data = OWNER_IFACE.encodeFunctionData("revoke", [getAddress(args.up), encodeBytes32String(args.reason)]);
        summary = `revoke the badge of ${getAddress(args.up)} (${args.reason})`;
        break;
      }
      case "reinstate":
        if (!isAddress(args.up ?? "")) throw new AdminError(400, "INVALID_ARGS");
        data = OWNER_IFACE.encodeFunctionData("reinstate", [getAddress(args.up)]);
        summary = `reinstate the badge of ${getAddress(args.up)}`;
        break;
      case "stopMinting":
        data = OWNER_IFACE.encodeFunctionData("setAttester", [ZERO]);
        summary = "EMERGENCY STOP: attester set to zero, no new badges";
        break;
      case "restoreAttester":
        if (!minterAddress) throw new AdminError(400, "INVALID_ARGS");
        data = OWNER_IFACE.encodeFunctionData("setAttester", [minterAddress]);
        summary = `restore the attester ${minterAddress}`;
        break;
      case "setMetadata": {
        const json = readMetadataFile();
        if (!json) throw new AdminError(400, "METADATA_FILE_MISSING");
        data = OWNER_IFACE.encodeFunctionData("setData", [LSP4_METADATA_KEY, metadataValue(json, metadataUrl())]);
        summary = `set the badge metadata (LSP4Metadata -> ${metadataUrl()})`;
        break;
      }
      default:
        throw new AdminError(400, "INVALID_ACTION");
    }
    return { to: contract, data, value: "0x0", summary, mainnet: cfg.deployment.chainId === 42 };
  }

  /** A5: audit log and e-mail. */
  function logAction(by, action, { txHash = null, detail = null } = {}) {
    audit(db, `admin_${action}`, { up: by, txHash, detail }, clock());
    notify(db, {
      kind: "admin_action",
      severity: action === "stopMinting" ? "problem" : "event",
      subject: `admin: ${action}${detail ? ` (${detail})` : ""}`,
      body: [`Admin action by the owner UP ${by} on ${cfg.network}:`, `  ${action}${detail ? `: ${detail}` : ""}`, txHash ? `  tx ${txHash}` : ""].join("\n"),
    }, clock());
  }

  return { createChallenge, login, session, logout: (token) => sessions.delete(hashToken(token ?? "").toString("hex")), status, exceptions, rejectException, badge, buildTx, logAction };
}

const parseCookie = (header = "", name) => {
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
};

/** Express router for /api/admin. Errors (AdminError) go to the app's error handler. */
export function adminRouter(admin, cfg, { limiter } = {}) {
  const r = express.Router();
  const secure = cfg.publicOrigin.startsWith("https://");
  const cookie = (token, maxAgeSec) =>
    `${COOKIE}=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (e) {
      next(e);
    }
  };
  // state-changing requests only from our own pages (on top of SameSite=Strict)
  const sameOrigin = (req, _res, next) => {
    const origin = req.get("Origin");
    if (origin && origin !== cfg.publicOrigin) return next(new AdminError(403, "BAD_ORIGIN"));
    next();
  };
  const auth = (req, _res, next) => {
    const s = admin.session(parseCookie(req.get("Cookie"), COOKIE));
    if (!s) return next(new AdminError(401, "ADMIN_LOGIN_REQUIRED"));
    req.admin = s;
    next();
  };
  if (limiter) r.use(limiter);

  r.post("/challenge", sameOrigin, handle(async (req, res) => res.json(await admin.createChallenge(req.body?.up))));
  r.post("/login", sameOrigin, handle(async (req, res) => {
    const s = await admin.login(req.body?.id, req.body?.signature);
    res.set("Set-Cookie", cookie(s.token, SESSION_TTL_MS / 1000)).json({ up: s.up, expiresAt: s.expiresAt });
  }));
  r.post("/logout", sameOrigin, (req, res) => {
    admin.logout(parseCookie(req.get("Cookie"), COOKIE));
    res.set("Set-Cookie", cookie("", 0)).json({ ok: true });
  });
  r.get("/session", auth, (req, res) => res.json({ up: req.admin.up, expiresAt: iso(req.admin.expires) }));
  r.get("/status", auth, handle(async (_req, res) => res.json(await admin.status())));
  r.get("/exceptions", auth, handle(async (_req, res) => res.json(await admin.exceptions())));
  r.post("/exceptions/:ticket/reject", sameOrigin, auth, (req, res) => {
    admin.rejectException(req.params.ticket, req.admin.up);
    res.json({ ok: true });
  });
  r.get("/badge/:up", auth, handle(async (req, res) => res.json(await admin.badge(req.params.up))));
  r.post("/tx", sameOrigin, auth, handle(async (req, res) => res.json(await admin.buildTx(req.body?.action, req.body?.args))));
  r.post("/log", sameOrigin, auth, (req, res) => {
    const { action, txHash, detail } = req.body ?? {};
    if (typeof action !== "string" || !/^[A-Za-z]{1,40}$/.test(action)) throw new AdminError(400, "INVALID_ARGS");
    if (txHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new AdminError(400, "INVALID_ARGS");
    const d = typeof detail === "string" ? detail.slice(0, 120).replace(/[^\x20-\x7e]/g, "") : null;
    admin.logAction(req.admin.up, action, { txHash: txHash ?? null, detail: d });
    res.json({ ok: true });
  });
  return r;
}
