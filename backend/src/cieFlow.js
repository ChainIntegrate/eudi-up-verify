// CIE submission flow for a statement already signed by the UP:
//   verify CIE (sync, in the request) -> person key + encrypted cert ref -> serial queue:
//   uniqueness decision -> [invalidate old primary] -> attest -> record.
// The tax code returned by the verifier is used once to derive the person key and then dropped.
import { audit } from "./db.js";
import { CieError } from "./cie/pki.js";
import { verifyCieCades, verifyCieRaw } from "./cie/verify.js";
import { LinkError, applyLink, decide } from "./linking.js";
import { notify } from "./notify.js";
import { encryptCertRef, personKey as derivePersonKey } from "./secrets.js";
import { getStatement, statementText } from "./statements.js";

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
 * @param deps {{db, cfg, trust, pepper: Buffer, certRefKey: Buffer, badge, minter, queue, ocspTransport?, clock?}}
 */
export function createCieFlow(deps) {
  const { db, cfg, trust, pepper, certRefKey, badge, minter, queue, ocspTransport, clock = Date.now } = deps;

  async function submit(statementId, channel, payload) {
    const row = getStatement(db, statementId);
    if (!row) throw new FlowError(404, "NOT_FOUND");
    const now = clock();
    if (row.status === "pending_up") throw new FlowError(409, "UP_SIGNATURE_REQUIRED");
    if (row.status !== "pending_cie") throw new FlowError(409, "ALREADY_SUBMITTED");
    if (now > row.expires_at) throw new FlowError(410, "STATEMENT_EXPIRED");
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

    const job = {
      personKey: derivePersonKey(pepper, result.taxCode),
      certRefEnc: encryptCertRef(certRefKey, result.certRef),
      expiresAtSec: Math.floor(result.notAfter.getTime() / 1000),
    };
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
    setStatus(db, row.id, { status: "minting" });
    let invalidateTxHash = null;
    try {
      if (plan.invalidate) {
        invalidateTxHash = await minter.invalidate(plan.invalidate, "MIGRATED");
        db.prepare("UPDATE links SET status = 'invalidated', is_primary = 0, tx_hash = ?, updated_at = ? WHERE up = ?").run(
          invalidateTxHash,
          clock(),
          plan.invalidate,
        );
        audit(db, "invalidated", { up: plan.invalidate, txHash: invalidateTxHash, detail: "MIGRATED" }, clock());
      }
      const txHash = await minter.attest(row.up, job.expiresAtSec, plan.primary);
      applyLink(
        db,
        {
          up: row.up,
          personKey: job.personKey,
          primary: plan.primary,
          expiresAtMs: job.expiresAtSec * 1000,
          certRefEnc: job.certRefEnc,
          txHash,
        },
        clock(),
      );
      setStatus(db, row.id, { status: "done", tx_hash: txHash, exception_ticket: plan.ticket });
      audit(db, "attested", { up: row.up, txHash, detail: plan.primary ? "primary" : "additional" }, clock());
      if (cfg.notifyEachLink) {
        notify(db, {
          kind: "attested",
          severity: "info",
          subject: `badge ${plan.primary ? "primary" : "additional"} for ${row.up}`,
          body: `Badge minted for ${row.up} (${plan.primary ? "primary" : "additional"}, mode ${row.mode}), tx ${txHash}.`,
        }, clock());
      }
    } catch {
      setStatus(db, row.id, { status: "failed", error_code: "MINT_FAILED" });
      audit(db, "mint_failed", { up: row.up }, clock());
      notify(db, {
        kind: "mint_failed",
        severity: "problem",
        subject: `minting failed for ${row.up}`,
        body: `attest()/invalidate() failed for ${row.up} (mode ${row.mode}). Check the attester balance and the RPC. The holder has to link again.`,
      }, clock());
    }
  }

  return { submit };
}

/** After a restart, statements caught mid-flight cannot resume (the person key was only in memory). */
export function failInterrupted(db) {
  return db
    .prepare("UPDATE statements SET status = 'failed', error_code = 'INTERRUPTED' WHERE status IN ('verifying','queued','minting')")
    .run().changes;
}
