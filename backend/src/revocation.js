// Periodic revocation recheck (D5.2): for every valid, unexpired link, OCSP with the stored (encrypted) certificate
// reference. A revoked certificate invalidates the badge on-chain (generic reason, see mints.js) and notifies.
// OCSP unreachable during the recheck does NOT invalidate anything (B2): after 3 consecutive days without a usable
// answer a problem is notified.
import { kvGet, kvSet } from "./db.js";
import { CieError, certSha256 } from "./cie/pki.js";
import { ocspStatus } from "./cie/ocsp.js";
import { notify } from "./notify.js";
import { decryptCertRef } from "./secrets.js";
import { processInvalidations, scheduleInvalidation } from "./mints.js";

const DAY = 86_400_000;

/**
 * @param {{db, trust, certRefKey: Buffer, queue, minter, badge, transport?: Function, now?: () => number, unavailableDaysAlert?: number}} p
 */
export async function runRevocationCheck({ db, trust, certRefKey, queue, minter, badge, transport, now = Date.now, unavailableDaysAlert = 3 }) {
  const t = now();
  const issuers = new Map([...trust.intermediates, ...trust.roots].map((c) => [certSha256(c), c]));
  const links = db.prepare("SELECT up, cert_ref_enc FROM links WHERE status = 'valid' AND expires_at > ? AND cert_ref_enc IS NOT NULL").all(t);
  const result = { checked: 0, good: 0, revoked: 0, unavailable: 0, errors: 0 };

  for (const link of links) {
    result.checked++;
    let status;
    try {
      const ref = decryptCertRef(certRefKey, link.cert_ref_enc);
      const issuer = issuers.get(ref.issuerSha256);
      if (!issuer) throw new CieError("ISSUER_NOT_IN_TRUST_STORE");
      status = await ocspStatus({ issuer, serialHex: ref.serialHex, url: ref.ocspUrl, transport, now: new Date(t) });
    } catch (e) {
      status = e instanceof CieError && e.code === "OCSP_UNAVAILABLE" ? "unavailable" : "error";
    }
    db.prepare("UPDATE links SET last_ocsp_at = ?, last_ocsp_status = ? WHERE up = ?").run(t, status, link.up);

    if (status === "good") result.good++;
    else if (status === "unavailable") result.unavailable++;
    else if (status === "revoked") {
      result.revoked++;
      // the local link stops counting now; the on-chain invalidation goes through the queue (retried)
      scheduleInvalidation(db, link.up, "CERT_REVOKED", t);
      await queue.push(() => processInvalidations({ db, minter, badge, now }));
    } else result.errors++;
  }

  // Streak of days in which OCSP never gave a usable answer (only when there was something to check).
  const streak = kvGet(db, "ocsp_unavailable", { days: 0, lastDay: null });
  const day = new Date(t).toISOString().slice(0, 10);
  if (result.checked > 0 && result.unavailable === result.checked) {
    if (streak.lastDay !== day) {
      streak.days += 1;
      streak.lastDay = day;
    }
    if (streak.days === unavailableDaysAlert) {
      notify(db, {
        kind: "ocsp_unavailable",
        severity: "problem",
        subject: `OCSP unreachable for ${streak.days} days`,
        body: `The Ministero dell'Interno OCSP service did not answer during the revocation recheck for ${streak.days} consecutive days. No badge is invalidated because of this; new verifications are refused while OCSP is down (fail-closed).`,
      }, t);
    }
  } else if (result.checked > 0) {
    streak.days = 0;
    streak.lastDay = day;
  }
  kvSet(db, "ocsp_unavailable", streak);
  kvSet(db, "revocation", { at: t, ...result });
  return result;
}

/** Deletes expired statements after 7 days and marks exception requests untouched for 30 days as abandoned. */
export function runCleanup(db, now = Date.now()) {
  const statements = db.prepare("DELETE FROM statements WHERE expires_at < ?").run(now - 7 * DAY).changes;
  const exceptions = db
    .prepare("UPDATE exception_requests SET status = 'abandoned' WHERE status = 'pending' AND created_at < ?")
    .run(now - 30 * DAY).changes;
  const notifications = db.prepare("DELETE FROM notifications WHERE sent_at IS NOT NULL AND sent_at < ?").run(now - 90 * DAY).changes;
  return { statements, exceptions, notifications };
}
