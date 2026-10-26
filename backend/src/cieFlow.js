// CIE submission flow for a statement already signed by the UP:
//   verify CIE (sync, in the request) -> person key + encrypted cert ref -> serial queue:
//   uniqueness decision -> record the mint (mints) -> attest -> record the link -> [invalidate the old primary].
// UCL-20: on a migration the new UP is attested first; the old primary is invalidated afterwards (retried).
// The tax code returned by the verifier is used once to derive the person key and then dropped.
import { audit } from "./db.js";
import { CieError } from "./cie/pki.js";
import { verifyCieCades, verifyCieRaw } from "./cie/verify.js";
import { isAtLeast } from "./cie/taxcode.js";
import { LinkError, decide } from "./linking.js";
import { badgeExpiry, failMint, finishMint, processInvalidations, recordMintTx, startMint } from "./mints.js";
import { notify } from "./notify.js";
import { getStatement, statementText } from "./statements.js";

export const MIN_AGE = 18; // UCL-11

export class FlowError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const setStatus = (db, id, fields) => {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE statements SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ id, ...fields });
};

/**
 * @param deps {{db, cfg, trust, signer, signerReady?: () => boolean, badge, minter, queue, ocspTransport?, clock?}}
 *   signer: person key and certificate reference come from the signer process (UCL-08); signerReady() false
 *   (not checked yet, unreachable at start-up, pepper mismatch) refuses new CIE files with SERVICE_UNAVAILABLE.
 */
export function createCieFlow(deps) {
  const { db, cfg, trust, signer, signerReady = () => true, badge, minter, queue, ocspTransport, clock = Date.now } = deps;

  async function submit(statementId, channel, payload) {
    const row = getStatement(db, statementId);
    if (!row) throw new FlowError(404, "NOT_FOUND");
    const now = clock();
    if (row.status === "pending_up") throw new FlowError(409, "UP_SIGNATURE_REQUIRED");
    if (row.status !== "pending_cie") throw new FlowError(409, "ALREADY_SUBMITTED");
    if (now > row.expires_at) throw new FlowError(410, "STATEMENT_EXPIRED");
    if (!signerReady()) throw new FlowError(503, "SERVICE_UNAVAILABLE"); // the statement stays usable
    // single submission per statement
    if (db.prepare("UPDATE statements SET status = 'verifying' WHERE id = ? AND status = 'pending_cie'").run(row.id).changes !== 1) {
      throw new FlowError(409, "ALREADY_SUBMITTED");
    }

    const text = Buffer.from(statementText(cfg, row), "ascii");
    const ctx = { trust, ocspTransport, now: new Date(now) };
    let result;
    try {
      result =
        channel === "cades"
          ? await verifyCieCades(payload.p7m, text, ctx)
          : await verifyCieRaw(payload.certificate, payload.signature, text, ctx);
    } catch (e) {
      const code = e instanceof CieError ? e.code : "CIE_VERIFICATION_ERROR";
      setStatus(db, row.id, { status: "failed", error_code: code });
      audit(db, "cie_rejected", { up: row.up, detail: code }, clock());
      throw new FlowError(code === "OCSP_UNAVAILABLE" ? 503 : 400, code);
    }

    // UCL-11: adults only (age read from the tax code in memory; the code is never logged or stored)
    if (!isAtLeast(result.taxCode, MIN_AGE, new Date(now))) {
      result.taxCode = undefined;
      setStatus(db, row.id, { status: "failed", error_code: "AGE_NOT_ELIGIBLE" });
      audit(db, "cie_rejected", { up: row.up, detail: "AGE_NOT_ELIGIBLE" }, clock());
      throw new FlowError(400, "AGE_NOT_ELIGIBLE");
    }

    // UCL-34: the badge expires on the first day of the card's expiry month, so a card expiring this month is too late
    if (badgeExpiry(result.notAfter) * 1000 <= now) {
      result.taxCode = undefined;
      setStatus(db, row.id, { status: "failed", error_code: "CARD_EXPIRING" });
      audit(db, "cie_rejected", { up: row.up, detail: "CARD_EXPIRING" }, clock());
      throw new FlowError(400, "CARD_EXPIRING");
    }

    let job;
    try {
      job = {
        personKey: await signer.personKey(result.taxCode),
        certRefEnc: await signer.encryptCertRef(result.certRef),
        expiresAtSec: badgeExpiry(result.notAfter), // UCL-03/34
      };
    } catch (e) {
      // UCL-08: the signer is down or at its rate limit; the CIE was valid but nothing is kept
      result.taxCode = undefined;
      const code = e?.code === "RATE_LIMITED" ? "SERVICE_BUSY" : "SERVICE_UNAVAILABLE";
      setStatus(db, row.id, { status: "failed", error_code: code });
      audit(db, "cie_not_processed", { up: row.up, detail: e?.code ?? "error" }, clock());
      if (code === "SERVICE_BUSY") {
        notify(db, {
          kind: "signer_busy",
          severity: "problem",
          subject: "signer: person-key rate limit reached",
          body: "The signer refused a person key (SIGNER_MAX_PERSON_KEYS_PER_MINUTE). With real traffic raise the limit in /etc/up-cie-link/signer.env; otherwise something is asking for person keys in bulk: check the server.",
        }, clock());
      }
      throw new FlowError(503, code);
    }
    result.taxCode = undefined; // drop personal data as soon as the key is derived
    setStatus(db, row.id, { status: "queued" });
    audit(db, "cie_verified", { up: row.up }, clock());
    queue.push(() => process(row, job)).catch(() => {});
    return getStatement(db, row.id);
  }

  async function process(row, job) {
    let plan;
    try {
      plan = await decide(db, badge, { up: row.up, mode: row.mode, personKey: job.personKey }, clock());
    } catch (e) {
      if (!(e instanceof LinkError)) throw e;
      setStatus(db, row.id, { status: "failed", error_code: e.code, exception_ticket: e.ticket ?? null });
      audit(db, "link_refused", { up: row.up, detail: e.code }, clock());
      if (e.code === "EXCEPTION_REQUIRED") {
        notify(db, {
          kind: "exception_requested",
          severity: "event",
          subject: `exception requested for an additional UP (${row.up})`,
          body: [
            `A person who already has a primary UP asks to link the additional UP ${row.up}.`,
            `Ticket: ${e.ticket}`,
            "",
            "If you approve, call from the owner UP (ChainIntegrate) on the contract",
            `${cfg.deployment.address} (${cfg.network}):`,
            `  approveException(${e.ticket}, 2)`,
            "(2 = primary + one additional UP; use a higher number to allow more).",
            "Then the holder links the UP again with mode \"additional\".",
          ].join("\n"),
        }, clock());
      }
      if (e.code === "EXCEPTION_LIMIT_REACHED") {
        notify(db, {
          kind: "exception_limit",
          severity: "event",
          subject: `exception limit reached (${row.up})`,
          body: [
            `A person asks to link one more additional UP (${row.up}) but has reached the approved limit.`,
            `Ticket: ${e.ticket}`,
            `To allow it, call approveException(${e.ticket}, <higher number>) from the owner UP on ${cfg.deployment.address}.`,
          ].join("\n"),
        }, clock());
      }
      return;
    }
    // UCL-04: the mint is recorded before anything is sent
    const mint = {
      statementId: row.id,
      up: row.up,
      personKey: job.personKey,
      primary: plan.primary,
      expiresAt: job.expiresAtSec * 1000,
      certRefEnc: job.certRefEnc,
      replacesUp: plan.invalidate,
      ticket: plan.ticket,
    };
    db.transaction(() => {
      startMint(db, mint, clock());
      setStatus(db, row.id, { status: "minting" });
    })();
    const mintRow = () => db.prepare("SELECT * FROM mints WHERE statement_id = ?").get(row.id);
    let txHash;
    try {
      txHash = await minter.attest(row.up, job.expiresAtSec, plan.primary, { onSent: (h) => recordMintTx(db, row.id, h) });
    } catch (e) {
      if (e?.code === "TX_TIMEOUT" || e?.code === "SEND_FAILED") {
        // the transaction may still be mined: the mint stays open and reconcileMints() closes it
        audit(db, "mint_pending", { up: row.up, txHash: e.txHash ?? null, detail: e.code }, clock());
        return;
      }
      if (e?.code === "MINT_RATE_LIMITED") {
        // UCL-08, decision A: the signer's hourly/daily cap; the person retries later, the owner is told at once
        failMint(db, mintRow(), "MINT_RATE_LIMITED", clock());
        notify(db, {
          kind: "mint_rate_limited",
          severity: "problem",
          subject: `mint limit reached: badge for ${row.up} not minted`,
          body: [
            `The signer refused attest() for ${row.up}: its hourly or daily mint limit is reached.`,
            "The holder was told to try again later. If this is real traffic, raise SIGNER_MAX_ATTEST_PER_HOUR /",
            "SIGNER_MAX_ATTEST_PER_DAY in /etc/up-cie-link/signer.env and restart the signer; if not, someone is",
            "minting through the backend: stop minting from the admin page and check the server.",
          ].join("\n"),
        }, clock());
        return;
      }
      failMint(db, mintRow(), "MINT_FAILED", clock());
      notify(db, {
        kind: "mint_failed",
        severity: "problem",
        subject: `minting failed for ${row.up}`,
        body: `attest() failed for ${row.up} (mode ${row.mode}, ${e?.code ?? "error"}). Check the attester balance and the RPC. The holder has to link again.`,
      }, clock());
      return;
    }
    finishMint(db, mintRow(), txHash, clock());
    if (cfg.notifyEachLink) {
      notify(db, {
        kind: "attested",
        severity: "info",
        subject: `badge ${plan.primary ? "primary" : "additional"} for ${row.up}`,
        body: `Badge minted for ${row.up} (${plan.primary ? "primary" : "additional"}, mode ${row.mode}), tx ${txHash}.`,
      }, clock());
    }
    if (plan.invalidate) await processInvalidations({ db, minter, badge, now: clock });
  }

  return { submit };
}

/**
 * After a restart, statements caught before the mint was recorded cannot resume (the person key was only in
 * memory). Statements with a recorded mint are left to reconcileMints().
 */
export function failInterrupted(db) {
  return db
    .prepare(
      `UPDATE statements SET status = 'failed', error_code = 'INTERRUPTED'
       WHERE status IN ('verifying','queued','minting') AND id NOT IN (SELECT statement_id FROM mints)`,
    )
    .run().changes;
}
