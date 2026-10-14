// Event indexer: reads UpCieBadge events from DEPLOY_BLOCK onwards (never from block zero) in bounded ranges and
// keeps the local `links` table in sync with the chain, which is the source of truth. This also catches actions
// taken outside the backend flow: a holder's renounce(), the owner's revoke()/reinstate(), a mint whose result
// was lost because of a restart.
import { Interface, decodeBytes32String, getAddress } from "ethers";
import { BADGE_ABI } from "./chain.js";
import { audit, kvSet } from "./db.js";
import { notify } from "./notify.js";

const iface = new Interface(BADGE_ABI);
const CURSOR = "badge";
const reasonText = (r) => {
  try {
    return decodeBytes32String(r);
  } catch {
    return r;
  }
};

/**
 * @param {{db, provider, address: string, deployBlock: number, maxRange?: number, confirmations?: number, now?: () => number}} p
 * @returns {Promise<{from: number, to: number, events: number}>}
 */
export async function runIndexer({ db, provider, address, deployBlock, maxRange = 2000, confirmations = 2, now = Date.now }) {
  const cursor = db.prepare("SELECT last_block FROM chain_cursor WHERE name = ?").get(CURSOR);
  const from = cursor ? cursor.last_block + 1 : deployBlock;
  // eth_blockNumber directly: ethers caches getBlockNumber() for a few seconds
  const head = Number(await provider.send("eth_blockNumber", [])) - confirmations;
  if (head < from) return { from, to: from - 1, events: 0 };

  let events = 0;
  for (let start = from; start <= head; start += maxRange) {
    const end = Math.min(start + maxRange - 1, head);
    const logs = await provider.getLogs({ address, fromBlock: start, toBlock: end });
    db.transaction(() => {
      for (const log of logs) {
        let ev;
        try {
          ev = iface.parseLog(log);
        } catch {
          continue;
        }
        if (!ev) continue;
        events++;
        apply(db, ev, log, now());
      }
      db.prepare(
        "INSERT INTO chain_cursor (name, last_block) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET last_block = excluded.last_block",
      ).run(CURSOR, end);
    })();
  }
  kvSet(db, "indexer", { lastBlock: head, at: now() });
  return { from, to: head, events };
}

function apply(db, ev, log, nowMs) {
  const up = getAddress(ev.args.up);
  const link = db.prepare("SELECT * FROM links WHERE up = ?").get(up);
  const tx = log.transactionHash;
  const block = log.blockNumber;
  // Events are applied in chain order; an event older than the last one applied to this link is ignored.
  const fresh = !link || link.last_event_block === null || block >= link.last_event_block;
  const mark = () => db.prepare("UPDATE links SET last_event_block = ? WHERE up = ?").run(block, up);
  switch (ev.name) {
    case "Attested": {
      if (!link) {
        // Minted by our attester but not recorded (e.g. restart during minting): the person is unknown here.
        audit(db, "attested_unrecorded", { up, txHash: tx }, nowMs);
        notify(db, {
          kind: "attested_unrecorded",
          severity: "problem",
          subject: `badge minted but not recorded for ${up}`,
          body: `The contract shows a badge for ${up} (tx ${tx}) that the backend did not record, probably because of a restart during minting.\nThe uniqueness key of that person is not stored: if needed, invalidate the badge and ask the holder to link again.`,
        }, nowMs);
        return;
      }
      if (!fresh) return;
      db.prepare("UPDATE links SET status = 'valid', is_primary = ?, expires_at = ?, tx_hash = ?, updated_at = ? WHERE up = ?").run(
        ev.args.primary ? 1 : 0,
        Number(ev.args.expiresAt) * 1000,
        tx,
        nowMs,
        up,
      );
      mark();
      return;
    }
    case "Invalidated": {
      const reason = reasonText(ev.args.reason);
      if (link && fresh) {
        db.prepare("UPDATE links SET status = 'invalidated', is_primary = 0, tx_hash = ?, updated_at = ? WHERE up = ?").run(tx, nowMs, up);
        mark();
      }
      if (reason === "SELF") {
        audit(db, "renounced", { up, txHash: tx }, nowMs);
        notify(db, {
          kind: "renounced",
          severity: "event",
          subject: `holder renounced the badge of ${up}`,
          body: `The holder of ${up} called renounce() (tx ${tx}). The badge is invalidated; the UP can be linked again with a new CIE signature.`,
        }, nowMs);
      }
      return;
    }
    case "Revoked": {
      if (link && fresh) {
        db.prepare("UPDATE links SET status = 'revoked', is_primary = 0, tx_hash = ?, updated_at = ? WHERE up = ?").run(tx, nowMs, up);
        mark();
      }
      audit(db, "revoked", { up, txHash: tx, detail: reasonText(ev.args.reason) }, nowMs);
      notify(db, {
        kind: "revoked",
        severity: "event",
        subject: `owner revoked the badge of ${up}`,
        body: `The owner revoked the badge of ${up} (reason ${reasonText(ev.args.reason)}, tx ${tx}). The backend will refuse this UP until reinstate().`,
      }, nowMs);
      return;
    }
    case "Reinstated": {
      if (link && fresh) {
        db.prepare("UPDATE links SET status = 'invalidated', tx_hash = ?, updated_at = ? WHERE up = ?").run(tx, nowMs, up);
        mark();
      }
      audit(db, "reinstated", { up, txHash: tx }, nowMs);
      notify(db, {
        kind: "reinstated",
        severity: "event",
        subject: `owner reinstated ${up}`,
        body: `The owner reinstated ${up} (tx ${tx}). The UP can be linked again with a new CIE signature.`,
      }, nowMs);
      return;
    }
    default:
  }
}
