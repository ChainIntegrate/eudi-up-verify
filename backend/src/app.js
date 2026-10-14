// Express application. Dependencies are injected (db, config, UP checker, clock) so the routes are testable.
// Error responses carry stable codes only: never stack traces, never personal data.
import express from "express";
import { getAddress, isAddress } from "ethers";
import { FlowError } from "./cieFlow.js";
import { audit } from "./db.js";
import { MODES, STATEMENT_VERSION, createStatement, getStatement, publicStatus, sha256Hex, statementText } from "./statements.js";

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** Fixed-window rate limiter in memory, per IP and bucket. IPs are never stored on disk. */
export function rateLimiter({ windowMs, max, clock }) {
  const hits = new Map();
  return (req, _res, next) => {
    const now = clock();
    const key = `${req.ip}`;
    const entry = hits.get(key);
    if (!entry || now - entry.start >= windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
      return next();
    }
    if (++entry.count > max) return next(new HttpError(429, "RATE_LIMITED"));
    next();
  };
}

/**
 * @param {{db: any, cfg: any, upChecker: {isUniversalProfile: Function, isValidUpSignature: Function},
 *          cieFlow?: {submit: Function}, badge?: any, clock?: () => number}} deps
 */
export function createApp({ db, cfg, upChecker, cieFlow, badge, clock = Date.now }) {
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
  const creation = rateLimiter({ windowMs: 60_000, max: 10, clock });

  app.get("/api/health", general, (_req, res) => {
    res.json({ ok: true, network: cfg.network });
  });

  app.get("/api/config", general, (_req, res) => {
    res.json({
      network: cfg.network,
      chainId: cfg.deployment.chainId,
      contract: cfg.deployment.address,
      statementVersion: STATEMENT_VERSION,
      upSignatureWindowSec: cfg.upSignatureWindowSec,
      statementTtlSec: cfg.statementTtlSec,
      cieChannels: cfg.allowCadesUpload ? ["cades", "raw"] : ["raw"],
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
      const [verified, verifiedPrimary, a] = await Promise.all([badge.isVerified(up), badge.isVerifiedPrimary(up), badge.getAttestation(up)]);
      const STATUS = ["none", "valid", "invalidated", "revoked"];
      res.json({
        up,
        verified,
        verifiedPrimary,
        status: STATUS[Number(a.status)] ?? "unknown",
        primary: a.primary,
        verifiedAt: Number(a.verifiedAt) ? new Date(Number(a.verifiedAt) * 1000).toISOString() : null,
        expiresAt: Number(a.expiresAt) ? new Date(Number(a.expiresAt) * 1000).toISOString() : null,
      });
    } catch (e) {
      next(e instanceof HttpError ? e : new HttpError(502, "CHAIN_READ_FAILED"));
    }
  });

  app.use((_req, _res, next) => next(new HttpError(404, "NOT_FOUND")));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "INVALID_JSON" });
    console.error(`[error] ${err?.code ?? err?.name ?? "unknown"}`); // no message: it could carry input data
    res.status(500).json({ error: "INTERNAL" });
  });

  return app;
}
