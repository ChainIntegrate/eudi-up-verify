// Uniqueness rules (D3, docs/02-backend.md §4) and their application after minting.
// The person is known only by personKey (HMAC of the tax code). Decisions read the local DB (kept in sync with the
// chain by the indexer) and, for exceptions, the contract's exceptionOf(ticket).
import { newTicket } from "./secrets.js";

export class LinkError extends Error {
  constructor(code, extra = {}) {
    super(code);
    this.code = code;
    Object.assign(this, extra);
  }
}

const isActive = (link, nowMs) => link.status === "valid" && link.expires_at > nowMs;
export const MIGRATION_INTERVAL_MS = 30 * 86_400_000; // UCL-07: at most one migration per person in 30 days

/**
 * Decides what to do for a verified (UP, person) pair.
 * @returns {Promise<{primary: boolean, invalidate: string|null, ticket: string|null}>}
 * @throws LinkError with codes MINT_IN_PROGRESS, MIGRATION_TOO_SOON, UP_REVOKED, UP_LINKED_TO_ANOTHER_PERSON, MIGRATION_OR_EXCEPTION_REQUIRED,
 *         NO_PRIMARY_LINK, EXCEPTION_REQUIRED, EXCEPTION_PENDING, EXCEPTION_LIMIT_REACHED, EXCEPTION_WITHDRAWN
 */
export async function decide(db, badge, { up, mode, personKey }, nowMs = Date.now()) {
  // UCL-04: a mint still open (timeout, restart) for this person or this UP must be closed first
  if (db.prepare("SELECT 1 FROM mints WHERE person_key = ? OR up = ?").get(personKey, up)) throw new LinkError("MINT_IN_PROGRESS");
  const linkOfUp = db.prepare("SELECT * FROM links WHERE up = ?").get(up);
  if (linkOfUp?.status === "revoked") throw new LinkError("UP_REVOKED");
  // the chain is the source of truth for revocations (local rows are deleted after the retention period)
  if (badge.getAttestation && Number((await badge.getAttestation(up)).status) === 3) throw new LinkError("UP_REVOKED");
  if (linkOfUp && isActive(linkOfUp, nowMs) && !linkOfUp.person_key.equals(personKey)) {
    throw new LinkError("UP_LINKED_TO_ANOTHER_PERSON");
  }

  const personLinks = db.prepare("SELECT * FROM links WHERE person_key = ?").all(personKey);
  const activeElsewhere = personLinks.filter((l) => l.up !== up && isActive(l, nowMs));
  const primaryElsewhere = activeElsewhere.find((l) => l.is_primary === 1) ?? null;
  const sameUpOfPerson = linkOfUp && linkOfUp.person_key.equals(personKey) ? linkOfUp : null;

  // Renewal of a still-valid link of the same UP for the same person (e.g. renewed card): keep its role.
  // An invalidated link (renounced, migrated away) is NOT renewed this way: it goes through the normal rules.
  if (sameUpOfPerson && sameUpOfPerson.status === "valid" && mode === "link") {
    const keepPrimary = sameUpOfPerson.is_primary === 1 || !primaryElsewhere;
    return { primary: keepPrimary, invalidate: null, ticket: null };
  }

  if (mode === "link") {
    if (primaryElsewhere || activeElsewhere.length > 0) throw new LinkError("MIGRATION_OR_EXCEPTION_REQUIRED");
    return { primary: true, invalidate: null, ticket: null };
  }

  if (mode === "migrate") {
    // Moves the primary link here; without an active primary elsewhere it is just a first link.
    if (primaryElsewhere) {
      const person = db.prepare("SELECT last_migration_at FROM persons WHERE person_key = ?").get(personKey);
      if (person?.last_migration_at && nowMs - person.last_migration_at < MIGRATION_INTERVAL_MS) throw new LinkError("MIGRATION_TOO_SOON");
    }
    return { primary: true, invalidate: primaryElsewhere?.up ?? null, ticket: null };
  }

  // mode === "additional"
  if (!primaryElsewhere) throw new LinkError("NO_PRIMARY_LINK");
  const request = db
    .prepare("SELECT * FROM exception_requests WHERE person_key = ? AND status IN ('pending','approved') ORDER BY created_at DESC")
    .get(personKey);
  if (!request) {
    const ticket = newTicket();
    db.prepare("INSERT INTO exception_requests (ticket, person_key, status, created_at) VALUES (?, ?, 'pending', ?)").run(
      ticket,
      personKey,
      nowMs,
    );
    throw new LinkError("EXCEPTION_REQUIRED", { ticket });
  }
  const maxUps = Number(await badge.exceptionOf(request.ticket));
  if (maxUps === 0 && request.status === "approved") {
    // UCL-21: the owner withdrew the exception on-chain (approveException(ticket, 0))
    db.prepare("UPDATE exception_requests SET status = 'withdrawn' WHERE ticket = ?").run(request.ticket);
    throw new LinkError("EXCEPTION_WITHDRAWN");
  }
  if (maxUps === 0) throw new LinkError("EXCEPTION_PENDING", { ticket: request.ticket });
  if (activeElsewhere.length + 1 > maxUps) throw new LinkError("EXCEPTION_LIMIT_REACHED", { ticket: request.ticket });
  if (request.status !== "approved") db.prepare("UPDATE exception_requests SET status = 'approved' WHERE ticket = ?").run(request.ticket);
  return { primary: false, invalidate: null, ticket: request.ticket };
}

/** Records the outcome of a successful attest (and optional invalidation) in one transaction. */
export function applyLink(db, { up, personKey, primary, expiresAtMs, certRefEnc, txHash, invalidated, invalidateTxHash }, nowMs = Date.now()) {
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO persons (person_key, created_at) VALUES (?, ?)").run(personKey, nowMs);
    if (invalidated) {
      db.prepare("UPDATE links SET status = 'invalidated', is_primary = 0, tx_hash = ?, updated_at = ? WHERE up = ?").run(
        invalidateTxHash,
        nowMs,
        invalidated,
      );
    }
    db.prepare(
      `INSERT INTO links (up, person_key, is_primary, status, verified_at, expires_at, cert_ref_enc, tx_hash, updated_at)
       VALUES (@up, @personKey, @primary, 'valid', @now, @expiresAtMs, @certRefEnc, @txHash, @now)
       ON CONFLICT(up) DO UPDATE SET person_key = excluded.person_key, is_primary = excluded.is_primary, status = 'valid',
         verified_at = excluded.verified_at, expires_at = excluded.expires_at, cert_ref_enc = excluded.cert_ref_enc,
         last_ocsp_at = NULL, last_ocsp_status = NULL, tx_hash = excluded.tx_hash, updated_at = excluded.updated_at`,
    ).run({ up, personKey, primary: primary ? 1 : 0, now: nowMs, expiresAtMs, certRefEnc, txHash });
  })();
}
