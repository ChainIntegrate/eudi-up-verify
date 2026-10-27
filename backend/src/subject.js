// Data-subject requests (UCL-10): export and erasure of everything kept about the person linked to a UP.
// The person is found through the link of the given UP (person key = HMAC of the tax code).
// UCL-44: a self-service request covers the whole person only when the signing UP's link is valid today; a UP whose
// link has ended (migrated away, renounced, invalidated, revoked, expired) may have passed to someone else, so its
// requests cover that UP only. A person without any valid UP proves who they are with a CIE-signed request handled
// by the operator (scripts/data-subject.js --p7m). Erasure also forgets the person key: "one person, one primary UP" no longer applies
// to them (accepted trade-off, stated in the privacy notice). On-chain history cannot be erased; valid badges
// are invalidated through the pending-invalidation queue processed by the running backend.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress } from "ethers";
import { audit } from "./db.js";
import { notify } from "./notify.js";

function personOf(db, up) {
  const link = db.prepare("SELECT person_key FROM links WHERE up = ?").get(getAddress(up));
  return link?.person_key ?? null;
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

/** "person" when the UP's link is valid now, "up" when it has ended, null when the UP is unknown. */
export function requestScope(db, up, now = Date.now()) {
  const link = db.prepare("SELECT status, expires_at FROM links WHERE up = ?").get(getAddress(up));
  if (!link) return null;
  return link.status === "valid" && link.expires_at > now ? "person" : "up";
}

/** What is stored about one UP only (its link, statements and audit rows), for a UP whose link has ended. */
export function exportUp(db, upInput) {
  const up = getAddress(upInput);
  const l = db.prepare("SELECT * FROM links WHERE up = ?").get(up);
  if (!l) return null;
  return {
    scope: "this UP only: its link has ended, so the other UPs of the person are not included (UCL-44)",
    links: [{
      up: l.up,
      primary: l.is_primary === 1,
      status: l.status,
      verifiedAt: iso(l.verified_at),
      badgeExpiresAt: iso(l.expires_at),
      certificateReferenceStored: l.cert_ref_enc !== null,
      lastRevocationCheck: iso(l.last_ocsp_at),
      lastRevocationStatus: l.last_ocsp_status,
      transaction: l.tx_hash,
    }],
    statements: db
      .prepare("SELECT id, up, mode, status, error_code, issued_at FROM statements WHERE up = ? ORDER BY issued_at")
      .all(up)
      .map((s) => ({ id: s.id, up: s.up, mode: s.mode, status: s.status, errorCode: s.error_code, issuedAt: iso(s.issued_at) })),
    auditEvents: db
      .prepare("SELECT ts, event, up, tx_hash, detail FROM audit WHERE up = ? ORDER BY ts")
      .all(up)
      .map((a) => ({ at: iso(a.ts), event: a.event, up: a.up, transaction: a.tx_hash, detail: a.detail })),
  };
}

/** Erases one UP whose link has ended (nothing to invalidate); the person key goes when no link is left. */
export function eraseUp(db, upInput, now = Date.now()) {
  const up = getAddress(upInput);
  const l = db.prepare("SELECT person_key, status FROM links WHERE up = ?").get(up);
  if (!l) return null;
  db.transaction(() => {
    db.prepare("DELETE FROM statements WHERE up = ?").run(up);
    db.prepare("DELETE FROM audit WHERE up = ?").run(up);
    db.prepare("DELETE FROM notifications WHERE subject LIKE ? OR body LIKE ?").run(`%${up}%`, `%${up}%`);
    db.prepare("DELETE FROM links WHERE up = ?").run(up);
    if (!db.prepare("SELECT 1 FROM links WHERE person_key = ?").get(l.person_key)) {
      db.prepare("DELETE FROM exception_requests WHERE person_key = ?").run(l.person_key);
      db.prepare("DELETE FROM persons WHERE person_key = ?").run(l.person_key);
    }
    audit(db, "subject_erased", { detail: "one UP with an ended link" }, now);
  })();
  return { ups: [up], invalidations: 0 };
}

/** Everything stored about the person of `up` (null if unknown). */
export function exportSubject(db, up) {
  const personKey = personOf(db, up);
  if (!personKey) return null;
  const links = db.prepare("SELECT * FROM links WHERE person_key = ? ORDER BY verified_at").all(personKey);
  const ups = links.map((l) => l.up);
  const marks = ups.map(() => "?").join(",");
  const person = db.prepare("SELECT * FROM persons WHERE person_key = ?").get(personKey);
  return {
    personKey: `${personKey.toString("hex")} (HMAC of the tax code with a server secret; the tax code itself is not stored)`,
    firstLinkAt: iso(person?.created_at),
    lastMigrationAt: iso(person?.last_migration_at),
    links: links.map((l) => ({
      up: l.up,
      primary: l.is_primary === 1,
      status: l.status,
      verifiedAt: iso(l.verified_at),
      badgeExpiresAt: iso(l.expires_at),
      certificateReferenceStored: l.cert_ref_enc !== null,
      lastRevocationCheck: iso(l.last_ocsp_at),
      lastRevocationStatus: l.last_ocsp_status,
      transaction: l.tx_hash,
    })),
    exceptionRequests: db
      .prepare("SELECT ticket, status, created_at FROM exception_requests WHERE person_key = ?")
      .all(personKey)
      .map((r) => ({ ticket: r.ticket, status: r.status, createdAt: iso(r.created_at) })),
    statements: ups.length
      ? db
          .prepare(`SELECT id, up, mode, status, error_code, issued_at FROM statements WHERE up IN (${marks}) ORDER BY issued_at`)
          .all(...ups)
          .map((s) => ({ id: s.id, up: s.up, mode: s.mode, status: s.status, errorCode: s.error_code, issuedAt: iso(s.issued_at) }))
      : [],
    auditEvents: ups.length
      ? db
          .prepare(`SELECT ts, event, up, tx_hash, detail FROM audit WHERE up IN (${marks}) ORDER BY ts`)
          .all(...ups)
          .map((a) => ({ at: iso(a.ts), event: a.event, up: a.up, transaction: a.tx_hash, detail: a.detail }))
      : [],
  };
}

/**
 * Erases the person of `up`: links, person key, exception requests, statements, audit rows and notifications
 * about their UPs. Valid badges are queued for on-chain invalidation (reason ERASED).
 * @returns {{ups: string[], invalidations: number}|null}
 */
export function eraseSubject(db, up, now = Date.now()) {
  const personKey = personOf(db, up);
  if (!personKey) return null;
  if (db.prepare("SELECT 1 FROM mints WHERE person_key = ?").get(personKey)) {
    throw Object.assign(new Error("a badge is being minted for this person: retry in a few minutes"), { code: "MINT_IN_PROGRESS" });
  }
  const links = db.prepare("SELECT up, status FROM links WHERE person_key = ?").all(personKey);
  const ups = links.map((l) => l.up);
  let invalidations = 0;
  db.transaction(() => {
    for (const l of links) {
      if (l.status === "valid" || l.status === "invalidating") {
        db.prepare(
          "INSERT INTO pending_invalidations (up, reason, created_at) VALUES (?, 'ERASED', ?) ON CONFLICT(up) DO UPDATE SET reason = 'ERASED'",
        ).run(l.up, now);
        invalidations++;
      }
      db.prepare("DELETE FROM statements WHERE up = ?").run(l.up);
      db.prepare("DELETE FROM audit WHERE up = ?").run(l.up);
      db.prepare("DELETE FROM notifications WHERE subject LIKE ? OR body LIKE ?").run(`%${l.up}%`, `%${l.up}%`);
    }
    db.prepare("DELETE FROM links WHERE person_key = ?").run(personKey);
    db.prepare("DELETE FROM exception_requests WHERE person_key = ?").run(personKey);
    db.prepare("DELETE FROM persons WHERE person_key = ?").run(personKey);
    audit(db, "subject_erased", { detail: `${ups.length} UP(s), ${invalidations} invalidation(s) queued` }, now);
  })();
  return { ups, invalidations };
}

// UCL-31: self-service requests, authenticated by a signature of the UP. The challenge is stateless (HMAC with a
// per-process key, 5 minutes), so unauthenticated callers cannot fill server memory (compare UCL-32); only the
// tags of executed requests are remembered, until they expire, to make each signature single use.
const REQUEST_TTL_MS = 5 * 60_000;
export const SUBJECT_ACTIONS = ["export", "erase"];

export class SubjectError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const isoSec = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export function createSubjectRequests({ db, cfg, upChecker, clock = Date.now, key = randomBytes(32) }) {
  const used = new Map(); // tag -> expires
  const tagOf = (text) => createHmac("sha256", key).update(text).digest("hex");

  function challenge(upInput, action) {
    if (typeof upInput !== "string" || !isAddress(upInput)) throw new SubjectError(400, "INVALID_UP");
    if (!SUBJECT_ACTIONS.includes(action)) throw new SubjectError(400, "INVALID_ACTION");
    const now = clock();
    const text = [
      "up-cie-link data request v1",
      `Origin: ${cfg.statementOrigin ?? cfg.publicOrigin}`,
      `Chain-Id: ${cfg.deployment.chainId}`,
      `Universal-Profile: ${getAddress(upInput)}`,
      `Request: ${action}`,
      `Nonce: ${randomBytes(16).toString("base64url")}`,
      `Issued-At: ${isoSec(now)}`,
      `Expires-At: ${isoSec(now + REQUEST_TTL_MS)}`,
      action === "erase"
        ? "I ask to erase the data kept about the person linked to this UP and to invalidate their badges. / Chiedo di cancellare i dati conservati sulla persona collegata a questa UP e di invalidarne i bollini."
        : "I ask for a copy of the data kept about the person linked to this UP. / Chiedo una copia dei dati conservati sulla persona collegata a questa UP.",
    ].join("\n");
    return { text, tag: tagOf(text) };
  }

  /** Verifies the signed challenge and runs it: {action: "export", data} or {action: "erase", ups, invalidations}. */
  async function execute(text, tag, signature) {
    if (typeof text !== "string" || typeof tag !== "string" || typeof signature !== "string") throw new SubjectError(400, "INVALID_REQUEST");
    const expected = Buffer.from(tagOf(text), "hex");
    const given = Buffer.from(tag, "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new SubjectError(400, "INVALID_REQUEST");
    const field = (name) => text.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1];
    const up = field("Universal-Profile");
    const action = field("Request");
    const expires = Date.parse(field("Expires-At"));
    const now = clock();
    for (const [k, v] of used) if (v < now) used.delete(k);
    if (!(expires >= now) || used.has(tag)) throw new SubjectError(410, "REQUEST_EXPIRED");
    if (!(await upChecker.isValidUpSignature(up, text, signature))) throw new SubjectError(400, "INVALID_UP_SIGNATURE");
    if (used.has(tag)) throw new SubjectError(410, "REQUEST_EXPIRED"); // a concurrent copy got here first
    used.set(tag, expires);

    const scope = requestScope(db, up, now);
    if (!scope) throw new SubjectError(404, "NO_DATA");
    if (action === "export") {
      const data = scope === "person" ? exportSubject(db, up) : exportUp(db, up);
      audit(db, "subject_exported", { up, detail: `self-service, UP signature, scope ${scope}` }, now);
      notify(db, {
        kind: "subject_exported",
        severity: "event",
        subject: "data exported on request of the holder",
        body: `Self-service export signed by the UP ${up} (scope: ${scope === "person" ? "the whole person" : "that UP only"}).`,
      }, now);
      return { action, scope, data };
    }
    let r;
    try {
      r = scope === "person" ? eraseSubject(db, up, now) : eraseUp(db, up, now);
    } catch (e) {
      if (e.code === "MINT_IN_PROGRESS") throw new SubjectError(409, "MINT_IN_PROGRESS");
      throw e;
    }
    notify(db, {
      kind: "subject_erased",
      severity: "event",
      subject: "data erased on request of the holder",
      body: `Self-service erasure signed by the UP (scope: ${scope === "person" ? "the whole person" : "that UP only"}): ${r.ups.length} UP(s), ${r.invalidations} on-chain invalidation(s) queued.`,
    }, now);
    return { action, scope, ups: r.ups, invalidations: r.invalidations };
  }

  return { challenge, execute };
}
