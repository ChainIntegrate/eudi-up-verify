// Chain writes that must survive restarts (UCL-04, UCL-20):
//  - a mint is recorded in `mints` BEFORE its transaction is sent, with the hash as soon as it is known; it is
//    finished when the receipt arrives, or later by reconcileMints() (after a timeout or a restart);
//  - invalidations go through `pending_invalidations` and are retried until the badge is no longer valid.
// Every function that writes to the chain runs inside the serial queue.
// On-chain reasons are always the generic "INVALIDATED" (UCL-03); the precise reason stays in the local audit.
import { audit } from "./db.js";
import { notify } from "./notify.js";

export const ONCHAIN_REASON = "INVALIDATED";
const STATUS_VALID = 1;
const STATUS_REVOKED = 3;

/**
 * UCL-03: the badge expiry is the first day (00:00 UTC) of the month after the card expiry, so it does not carry
 * the holder's birthday (Italian identity documents expire on it) nor a per-person timestamp.
 * @param {Date} notAfter certificate expiry
 * @returns {number} unix seconds
 */
export function badgeExpiry(notAfter) {
  return Date.UTC(notAfter.getUTCFullYear(), notAfter.getUTCMonth() + 1, 1) / 1000;
}

export function startMint(db, m, nowMs) {
  db.prepare(
    `INSERT INTO mints (statement_id, up, person_key, is_primary, expires_at, cert_ref_enc, replaces_up, ticket, created_at)
     VALUES (@statementId, @up, @personKey, @primary, @expiresAt, @certRefEnc, @replacesUp, @ticket, @now)`,
  ).run({ ...m, primary: m.primary ? 1 : 0, replacesUp: m.replacesUp ?? null, ticket: m.ticket ?? null, certRefEnc: m.certRefEnc ?? null, now: nowMs });
}

export function recordMintTx(db, statementId, txHash) {
  db.prepare("UPDATE mints SET tx_hash = ? WHERE statement_id = ?").run(txHash, statementId);
  db.prepare("UPDATE statements SET tx_hash = ? WHERE id = ?").run(txHash, statementId);
}

/** Records the link, schedules the invalidation of the replaced primary, closes the statement. One transaction. */
export function finishMint(db, row, txHash, nowMs) {
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO persons (person_key, created_at) VALUES (?, ?)").run(row.person_key, nowMs);
    db.prepare(
      `INSERT INTO links (up, person_key, is_primary, status, verified_at, expires_at, cert_ref_enc, tx_hash, updated_at)
       VALUES (@up, @personKey, @primary, 'valid', @now, @expiresAt, @certRefEnc, @txHash, @now)
       ON CONFLICT(up) DO UPDATE SET person_key = excluded.person_key, is_primary = excluded.is_primary, status = 'valid',
         verified_at = excluded.verified_at, expires_at = excluded.expires_at, cert_ref_enc = excluded.cert_ref_enc,
         last_ocsp_at = NULL, last_ocsp_status = NULL, tx_hash = excluded.tx_hash, updated_at = excluded.updated_at`,
    ).run({ up: row.up, personKey: row.person_key, primary: row.is_primary, now: nowMs, expiresAt: row.expires_at, certRefEnc: row.cert_ref_enc, txHash });
    if (row.replaces_up) {
      scheduleInvalidation(db, row.replaces_up, "MIGRATED", nowMs);
      db.prepare("UPDATE persons SET last_migration_at = ? WHERE person_key = ?").run(nowMs, row.person_key);
    }
    db.prepare("UPDATE statements SET status = 'done', tx_hash = ?, exception_ticket = ? WHERE id = ?").run(txHash, row.ticket, row.statement_id);
    db.prepare("DELETE FROM mints WHERE statement_id = ?").run(row.statement_id);
    audit(db, "attested", { up: row.up, txHash, detail: row.is_primary ? "primary" : "additional" }, nowMs);
  })();
}

export function failMint(db, row, code, nowMs) {
  db.transaction(() => {
    db.prepare("UPDATE statements SET status = 'failed', error_code = ? WHERE id = ?").run(code, row.statement_id);
    db.prepare("DELETE FROM mints WHERE statement_id = ?").run(row.statement_id);
    audit(db, "mint_failed", { up: row.up, txHash: row.tx_hash ?? null }, nowMs);
  })();
}

/** The local link stops counting at once (not active); the on-chain invalidation follows through the queue. */
export function scheduleInvalidation(db, up, reason, nowMs) {
  db.prepare("INSERT OR IGNORE INTO pending_invalidations (up, reason, created_at) VALUES (?, ?, ?)").run(up, reason, nowMs);
  db.prepare("UPDATE links SET status = 'invalidating', is_primary = 0, updated_at = ? WHERE up = ? AND status = 'valid'").run(nowMs, up);
}

const markInvalidated = (db, up, txHash, nowMs) =>
  db
    .prepare("UPDATE links SET status = 'invalidated', is_primary = 0, cert_ref_enc = NULL, tx_hash = COALESCE(?, tx_hash), updated_at = ? WHERE up = ? AND status IN ('valid','invalidating')")
    .run(txHash, nowMs, up);

const REASON_TEXT = {
  MIGRATED: (up, tx) => [`migration: old primary ${up} invalidated`, `The holder moved the primary badge to another UP; ${up} was invalidated (tx ${tx}).`],
  CERT_REVOKED: (up, tx) => [`CIE certificate revoked: badge of ${up} invalidated`, `The CIE certificate linked to ${up} is revoked (OCSP). The badge was invalidated on-chain (tx ${tx}).`],
  // after an erasure the UP address is not written again (neither here nor in the audit)
  ERASED: (_up, tx) => ["erasure request: badge invalidated", `Personal data erased on request; the badge was invalidated on-chain (tx ${tx}).`],
};

/**
 * Sends the pending invalidations (inside the queue). A badge that is already not valid on-chain (renounced,
 * revoked) is simply closed. Failures are retried at the next run; a problem is notified after 3 attempts.
 */
export async function processInvalidations({ db, minter, badge, now = Date.now }) {
  const rows = db.prepare("SELECT * FROM pending_invalidations ORDER BY created_at").all();
  const result = { done: 0, closed: 0, failed: 0 };
  for (const row of rows) {
    try {
      const txHash = await minter.invalidate(row.up, ONCHAIN_REASON);
      db.transaction(() => {
        markInvalidated(db, row.up, txHash, now());
        db.prepare("DELETE FROM pending_invalidations WHERE up = ?").run(row.up);
        audit(db, "invalidated", { up: row.reason === "ERASED" ? null : row.up, txHash, detail: row.reason }, now());
      })();
      const [subject, body] = (REASON_TEXT[row.reason] ?? REASON_TEXT.MIGRATED)(row.up, txHash);
      if (row.reason !== "MIGRATED") notify(db, { kind: `invalidated_${row.reason.toLowerCase()}`, severity: "event", subject, body }, now());
      result.done++;
      continue;
    } catch (e) {
      if (e?.code === "SIMULATION_REVERTED") {
        let status = null;
        try {
          status = Number((await badge.getAttestation(row.up)).status);
        } catch { /* unknown: retry later */ }
        if (status !== null && status !== STATUS_VALID) {
          db.transaction(() => {
            if (status !== STATUS_REVOKED) markInvalidated(db, row.up, null, now());
            db.prepare("DELETE FROM pending_invalidations WHERE up = ?").run(row.up);
          })();
          result.closed++;
          continue;
        }
      }
    }
    const attempts = row.attempts + 1;
    db.prepare("UPDATE pending_invalidations SET attempts = ? WHERE up = ?").run(attempts, row.up);
    if (attempts === 3) {
      notify(db, {
        kind: "invalidate_failed",
        severity: "problem",
        subject: `could not invalidate ${row.up}`,
        body: `invalidate() of ${row.up} (${row.reason}) failed 3 times. Check the attester balance and the RPC; it is retried every minute.`,
      }, now());
    }
    result.failed++;
  }
  return result;
}

/**
 * Closes mints left open by a timeout or a restart (inside the queue).
 *  - hash known: receipt ok -> finish; receipt failed -> fail; still pending -> wait (problem after 30 minutes);
 *    unknown to the node for more than 10 minutes -> decide from the chain state;
 *  - no hash (crash before or during sending): after 10 minutes, decide from the chain state.
 */
export async function reconcileMints({ db, provider, badge, now = Date.now, settleMs = 10 * 60_000, stuckMs = 30 * 60_000 }) {
  const rows = db.prepare("SELECT * FROM mints ORDER BY created_at").all();
  const result = { finished: 0, failed: 0, waiting: 0 };
  for (const row of rows) {
    const age = now() - row.created_at;
    try {
      if (row.tx_hash) {
        const receipt = await provider.getTransactionReceipt(row.tx_hash);
        if (receipt) {
          if (receipt.status === 1) {
            finishMint(db, row, row.tx_hash, now());
            result.finished++;
          } else {
            failMint(db, row, "MINT_FAILED", now());
            result.failed++;
          }
          continue;
        }
        const pending = await provider.getTransaction(row.tx_hash);
        if (pending || age < settleMs) {
          if (age >= stuckMs && !row.alerted) {
            db.prepare("UPDATE mints SET alerted = 1 WHERE statement_id = ?").run(row.statement_id);
            notify(db, {
              kind: "tx_stuck",
              severity: "problem",
              subject: `attester transaction not mined for ${Math.round(age / 60_000)} minutes (${row.up})`,
              body: `attest() for ${row.up} (tx ${row.tx_hash}) is still pending. Later attester transactions wait behind it. Check the gas price and the RPC; if needed replace it with the same nonce and a higher fee.`,
            }, now());
          }
          result.waiting++;
          continue;
        }
      } else if (age < settleMs) {
        result.waiting++;
        continue;
      }
      // decide from the chain: valid and attested after this mint started -> it went through
      const a = await badge.getAttestation(row.up);
      if (Number(a.status) === STATUS_VALID && Number(a.verifiedAt) * 1000 >= row.created_at - 60_000) {
        finishMint(db, row, row.tx_hash, now());
        result.finished++;
      } else {
        failMint(db, row, "MINT_FAILED", now());
        result.failed++;
      }
    } catch {
      result.waiting++; // RPC trouble: retry at the next run
    }
  }
  return result;
}
