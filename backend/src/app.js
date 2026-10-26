// Express application. Dependencies are injected (db, config, UP checker, clock) so the routes are testable.
// Error responses carry stable codes only: never stack traces, never personal data.
import express from "express";
import { getAddress, isAddress } from "ethers";
import { AdminError, adminRouter } from "./admin.js";
import { FlowError } from "./cieFlow.js";
import { audit } from "./db.js";
import { SubjectError } from "./subject.js";
import { MODES, STATEMENT_VERSION, createStatement, getStatement, publicStatus, sha256Hex, statementText } from "./statements.js";

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** Client key for rate limits: the IPv4 address, or the /64 prefix of an IPv6 address (UCL-15). */
export function clientKey(ip = "") {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (!v4.includes(":")) return v4;
  // expand "::" and keep the first four groups
  const [head, tail = ""] = v4.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/**
 * Fixed-window rate limiter in memory, per client key and bucket. IPs are never stored on disk.
 * The map is bounded (UCL-15): when full, expired entries are dropped; if still full, new clients get 429.
 */
export function rateLimiter({ windowMs, max, clock, maxEntries = 50_000 }) {
  const hits = new Map();
  return (req, _res, next) => {
    const now = clock();
    const key = clientKey(req.ip);
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      if (!entry && hits.size >= maxEntries) {
        for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
        if (hits.size >= maxEntries) return next(new HttpError(429, "RATE_LIMITED"));
      }
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    if (++entry.count > max) return next(new HttpError(429, "RATE_LIMITED"));
    next();
  };
}

/** Short in-memory cache of badge reads (UCL-15: limits RPC calls caused by public requests). */
function badgeCache(ttlMs = 10_000, maxEntries = 10_000) {
  const cache = new Map();
  return async (key, now, load) => {
    const hit = cache.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value;
    const value = await load();
    if (cache.size >= maxEntries) cache.clear();
    cache.set(key, { at: now, value });
    return value;
  };
}

/**
 * @param {{db: any, cfg: any, upChecker: {isUniversalProfile: Function, isValidUpSignature: Function},
 *          cieFlow?: {submit: Function}, badge?: any, subject?: {challenge: Function, execute: Function},
 *          clock?: () => number}} deps
 */
export function createApp({ db, cfg, upChecker, cieFlow, badge, admin, subject, healthInfo = () => ({}), clock = Date.now }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback"); // behind nginx on the same host

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Cross-Origin-Resource-Policy": "same-site",
    });
    const origin = req.get("Origin");
    if (origin && origin === cfg.publicOrigin) {
      res.set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST",
        "Access-Control-Allow-Headers": "Content-Type",
        Vary: "Origin",
      });
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: "64kb" }));

  const general = rateLimiter({ windowMs: 60_000, max: 120, clock });
  const cachedBadge = badgeCache();
  const creation = rateLimiter({ windowMs: 60_000, max: 10, clock });

  // UCL-23: details (indexer, queue) only for local callers such as the monitor; through nginx just "ok"
  app.get("/api/health", general, (req, res) => {
    const local = req.ip === "127.0.0.1" || req.ip === "::1" || req.ip === "::ffff:127.0.0.1";
    res.json(local ? { ok: true, network: cfg.network, ...healthInfo() } : { ok: true });
  });

  app.get("/api/config", general, (_req, res) => {
    res.json({
      network: cfg.network,
      chainId: cfg.deployment.chainId,
      contract: cfg.deployment.address,
      statementVersion: STATEMENT_VERSION,
      upSignatureWindowSec: cfg.upSignatureWindowSec,
      statementTtlSec: cfg.statementTtlSec,
      walletConnectProjectId: cfg.walletConnectProjectId ?? null,
      cieChannels: [...(cfg.allowCadesUpload ? ["cades"] : []), ...(cfg.allowRawChannel ? ["raw"] : [])],
    });
  });

  app.post("/api/statements", creation, async (req, res, next) => {
    try {
      const { up, mode = "link" } = req.body ?? {};
      if (typeof up !== "string" || !isAddress(up)) throw new HttpError(400, "INVALID_UP");
      if (!MODES.includes(mode)) throw new HttpError(400, "INVALID_MODE");
      if (!(await upChecker.isUniversalProfile(up))) throw new HttpError(400, "NOT_A_UNIVERSAL_PROFILE");
      const s = createStatement(db, cfg, { up, mode }, clock());
      audit(db, "statement_created", { up: s.up, detail: mode }, clock());
      res.status(201).json({ ...publicStatus(getStatement(db, s.id), cfg, clock()), text: s.text });
    } catch (e) {
      next(e);
    }
  });

  app.get("/api/statements/:id", general, (req, res, next) => {
    const row = getStatement(db, req.params.id);
    if (!row) return next(new HttpError(404, "NOT_FOUND"));
    res.json({ ...publicStatus(row, cfg, clock()), text: statementText(cfg, row) });
  });

  // F8: the exact bytes to sign with CieSign (ASCII, LF, no trailing newline), as a file download
  app.get("/api/statements/:id/file", general, (req, res, next) => {
    const row = getStatement(db, req.params.id);
    if (!row) return next(new HttpError(404, "NOT_FOUND"));
    const text = statementText(cfg, row);
    if (sha256Hex(text) !== row.text_sha256) return next(new HttpError(500, "STATEMENT_INTEGRITY"));
    res.set({
      "Content-Type": "text/plain; charset=us-ascii",
      "Content-Disposition": `attachment; filename="up-cie-link-${row.id.slice(0, 8)}.txt"`,
    });
    res.send(Buffer.from(text, "ascii"));
  });

  app.post("/api/statements/:id/up-signature", general, async (req, res, next) => {
    try {
      const row = getStatement(db, req.params.id);
      if (!row) throw new HttpError(404, "NOT_FOUND");
      const now = clock();
      if (row.status !== "pending_up") throw new HttpError(409, "ALREADY_SIGNED");
      if (now > row.expires_at) throw new HttpError(410, "STATEMENT_EXPIRED");
      // anti-replay: the UP must sign within the window after issuance (CLAUDE.md: 5 minutes)
      if (now > row.issued_at + cfg.upSignatureWindowSec * 1000) throw new HttpError(410, "UP_SIGNATURE_WINDOW_EXPIRED");

      const { signature } = req.body ?? {};
      if (typeof signature !== "string") throw new HttpError(400, "INVALID_SIGNATURE");
      const text = statementText(cfg, row);
      if (sha256Hex(text) !== row.text_sha256) throw new HttpError(500, "STATEMENT_INTEGRITY");
      if (!(await upChecker.isValidUpSignature(row.up, text, signature))) throw new HttpError(400, "INVALID_UP_SIGNATURE");

      // single use: only one transition pending_up -> pending_cie can succeed
      const upd = db
        .prepare("UPDATE statements SET status = 'pending_cie', up_signed_at = ? WHERE id = ? AND status = 'pending_up'")
        .run(now, row.id);
      if (upd.changes !== 1) throw new HttpError(409, "ALREADY_SIGNED");
      audit(db, "up_signed", { up: row.up }, now);
      res.json(publicStatus(getStatement(db, row.id), cfg, now));
    } catch (e) {
      next(e);
    }
  });

  const cieLimiter = rateLimiter({ windowMs: 60_000, max: 20, clock });
  const submitCie = (channel, parse) => async (req, res, next) => {
    try {
      if (!cieFlow) throw new HttpError(503, "CIE_FLOW_UNAVAILABLE");
      const payload = parse(req);
      const row = await cieFlow.submit(req.params.id, channel, payload);
      res.status(202).json(publicStatus(row, cfg, clock()));
    } catch (e) {
      next(e instanceof FlowError ? new HttpError(e.status, e.code) : e);
    }
  };

  // CieSign .p7m upload (B7: tests/demo; disabled with ALLOW_CADES_UPLOAD=false)
  app.post(
    "/api/statements/:id/cie-cades",
    cieLimiter,
    (req, _res, next) => (cfg.allowCadesUpload ? next() : next(new HttpError(404, "CHANNEL_DISABLED"))),
    express.raw({ type: () => true, limit: "64kb" }),
    submitCie("cades", (req) => {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, "INVALID_P7M");
      return { p7m: req.body };
    }),
  );

  // Android app: raw PKCS#1 v1.5 / SHA-256 signature + holder certificate (both base64)
  app.post(
    "/api/statements/:id/cie-raw",
    cieLimiter,
    (req, _res, next) => (cfg.allowRawChannel ? next() : next(new HttpError(404, "CHANNEL_DISABLED"))),
    submitCie("raw", (req) => {
      const { certificate, signature } = req.body ?? {};
      const b64 = (v) => typeof v === "string" && /^[A-Za-z0-9+/=\s]+$/.test(v);
      if (!b64(certificate) || !b64(signature)) throw new HttpError(400, "INVALID_PAYLOAD");
      return { certificate: Buffer.from(certificate, "base64"), signature: Buffer.from(signature, "base64") };
    }),
  );

  // Badge state, read on-chain by the backend (the browser never calls the RPC)
  app.get("/api/badge/:up", general, async (req, res, next) => {
    try {
      if (!badge) throw new HttpError(503, "CHAIN_UNAVAILABLE");
      if (!isAddress(req.params.up)) throw new HttpError(400, "INVALID_UP");
      const up = getAddress(req.params.up);
      const body = await cachedBadge(up, clock(), async () => {
        const [verified, verifiedPrimary, a] = await Promise.all([badge.isVerified(up), badge.isVerifiedPrimary(up), badge.getAttestation(up)]);
        const STATUS = ["none", "valid", "invalidated", "revoked"];
        return {
          up,
          verified,
          verifiedPrimary,
          status: STATUS[Number(a.status)] ?? "unknown",
          primary: a.primary,
          verifiedAt: Number(a.verifiedAt) ? new Date(Number(a.verifiedAt) * 1000).toISOString() : null,
          expiresAt: Number(a.expiresAt) ? new Date(Number(a.expiresAt) * 1000).toISOString() : null,
        };
      });
      res.json(body);
    } catch (e) {
      next(e instanceof HttpError ? e : new HttpError(502, "CHAIN_READ_FAILED"));
    }
  });

  // UCL-31: data-subject requests (export / erase), signed by the UP from the "Il mio bollino" page
  if (subject) {
    app.post("/api/subject/challenge", creation, (req, res, next) => {
      try {
        const { up, action } = req.body ?? {};
        res.json(subject.challenge(up, action));
      } catch (e) {
        next(e);
      }
    });
    app.post("/api/subject/request", creation, async (req, res, next) => {
      try {
        const { text, tag, signature } = req.body ?? {};
        res.json(await subject.execute(text, tag, signature));
      } catch (e) {
        next(e);
      }
    });
  }

  // admin (owner of the contract only): docs/03-frontend.md §6
  if (admin) app.use("/api/admin", adminRouter(admin, cfg, { limiter: rateLimiter({ windowMs: 60_000, max: 60, clock }) }));

  app.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND")));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError || err instanceof AdminError || err instanceof SubjectError) return res.status(err.status).json({ error: err.code });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "INVALID_JSON" });
    console.error(`[error] ${err?.code ?? err?.name ?? "unknown"}`); // no message: it could carry input data
    res.status(500).json({ error: "INTERNAL" });
  });

  return app;
}
