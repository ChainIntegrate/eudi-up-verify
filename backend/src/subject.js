// Data-subject requests (UCL-10): export and erasure of everything kept about the person linked to a UP.
// The person is found through the link of the given UP (person key = HMAC of the tax code), so the request
// needs only the UP address. Erasure also forgets the person key: "one person, one primary UP" no longer applies
// to them (accepted trade-off, stated in the privacy notice). On-chain history cannot be erased; valid badges
// are invalidated through the pending-invalidation queue processed by the running backend.
import { getAddress } from "ethers";
import { audit } from "./db.js";

function personOf(db, up) {
  const link = db.prepare("SELECT person_key FROM links WHERE up = ?").get(getAddress(up));
  return link?.person_key ?? null;
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

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
