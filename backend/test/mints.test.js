// UCL-04 / UCL-20 / UCL-03: mints recorded before sending, reconciliation after a timeout or a restart,
// invalidations retried until the badge is no longer valid, badge expiry without the card's exact date.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { openDb } from "../src/db.js";
import { failInterrupted } from "../src/cieFlow.js";
import { LinkError, decide } from "../src/linking.js";
import { badgeExpiry, finishMint, processInvalidations, reconcileMints, scheduleInvalidation, startMint } from "../src/mints.js";

const UP = "0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C";
const UP2 = "0x4a2605796e0d91A9667d6E30365aEEC384C48c27";
const MIN = 60_000;
const HASH = `0x${"ab".repeat(32)}`;

function setup(now) {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO statements (id, up, mode, nonce, text_sha256, issued_at, expires_at, status) VALUES ('s1', ?, 'link', 'n', 'h', ?, ?, 'minting')")
    .run(UP, now, now + 15 * MIN);
  const personKey = randomBytes(32);
  startMint(db, { statementId: "s1", up: UP, personKey, primary: true, expiresAt: now + 1e9, certRefEnc: null }, now);
  return { db, personKey };
}
const chain = ({ receipt = null, pending = null, attestation = { status: 0n, verifiedAt: 0n } } = {}) => ({
  provider: { getTransactionReceipt: async () => receipt, getTransaction: async () => pending },
  badge: { getAttestation: async () => attestation },
});
const statusOf = (db) => db.prepare("SELECT status, error_code FROM statements WHERE id = 's1'").get();

describe("UCL-03: badge expiry", () => {
  it("is the first day of the month after the card expiry", () => {
    assert.equal(badgeExpiry(new Date("2033-03-14T10:20:30Z")), Date.UTC(2033, 3, 1) / 1000);
    assert.equal(badgeExpiry(new Date("2033-12-31T23:59:59Z")), Date.UTC(2034, 0, 1) / 1000);
    // two people with different birthdays in the same month get the same value
    assert.equal(badgeExpiry(new Date("2030-07-02T00:00:00Z")), badgeExpiry(new Date("2030-07-29T00:00:00Z")));
  });
});

describe("UCL-04: mints survive timeouts and restarts", () => {
  const now = Date.parse("2026-10-15T10:00:00Z");

  it("a restart does not fail a statement whose mint is recorded", () => {
    const { db } = setup(now);
    db.prepare("INSERT INTO statements (id, up, mode, nonce, text_sha256, issued_at, expires_at, status) VALUES ('s2', ?, 'link', 'n2', 'h', ?, ?, 'queued')")
      .run(UP2, now, now + 15 * MIN);
    assert.equal(failInterrupted(db), 1);
    assert.equal(statusOf(db).status, "minting");
  });

  it("a person or a UP with an open mint cannot start another one", async () => {
    const { db, personKey } = setup(now);
    await assert.rejects(decide(db, {}, { up: UP2, mode: "link", personKey }, now), (e) => e instanceof LinkError && e.code === "MINT_IN_PROGRESS");
    await assert.rejects(decide(db, {}, { up: UP, mode: "link", personKey: randomBytes(32) }, now), (e) => e.code === "MINT_IN_PROGRESS");
  });

  it("receipt ok: the link is recorded and the statement is done", async () => {
    const { db } = setup(now);
    db.prepare("UPDATE mints SET tx_hash = ?").run(HASH);
    const r = await reconcileMints({ db, ...chain({ receipt: { status: 1 } }), now: () => now + MIN });
    assert.deepEqual(r, { finished: 1, failed: 0, waiting: 0 });
    assert.equal(statusOf(db).status, "done");
    assert.equal(db.prepare("SELECT status, tx_hash FROM links WHERE up = ?").get(UP).tx_hash, HASH);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM mints").get().n, 0);
  });

  it("transaction still pending: waits, then one problem after 30 minutes", async () => {
    const { db } = setup(now);
    db.prepare("UPDATE mints SET tx_hash = ?").run(HASH);
    const c = chain({ pending: { hash: HASH } });
    assert.equal((await reconcileMints({ db, ...c, now: () => now + 5 * MIN })).waiting, 1);
    await reconcileMints({ db, ...c, now: () => now + 31 * MIN });
    await reconcileMints({ db, ...c, now: () => now + 40 * MIN });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'tx_stuck'").get().n, 1);
    assert.equal(statusOf(db).status, "minting");
  });

  it("no hash (crash while sending): after 10 minutes the chain decides", async () => {
    const early = setup(now);
    assert.equal((await reconcileMints({ db: early.db, ...chain(), now: () => now + 5 * MIN })).waiting, 1);

    const minted = setup(now);
    const valid = { status: 1n, verifiedAt: BigInt(Math.floor(now / 1000) + 5) };
    assert.equal((await reconcileMints({ db: minted.db, ...chain({ attestation: valid }), now: () => now + 11 * MIN })).finished, 1);
    assert.equal(statusOf(minted.db).status, "done");

    const lost = setup(now);
    assert.equal((await reconcileMints({ db: lost.db, ...chain(), now: () => now + 11 * MIN })).failed, 1);
    assert.deepEqual(statusOf(lost.db), { status: "failed", error_code: "MINT_FAILED" });
    assert.equal(lost.db.prepare("SELECT COUNT(*) n FROM links").get().n, 0);
  });
});

describe("UCL-20: invalidations are retried until done", () => {
  const now = Date.parse("2026-10-15T10:00:00Z");
  function withLink() {
    const { db } = setup(now);
    finishMint(db, db.prepare("SELECT * FROM mints").get(), HASH, now);
    scheduleInvalidation(db, UP, "MIGRATED", now);
    return db;
  }

  it("the local link stops counting at once; the transaction is retried after failures", async () => {
    const db = withLink();
    assert.equal(db.prepare("SELECT status FROM links").get().status, "invalidating");
    let fail = true;
    const calls = [];
    const minter = { invalidate: async (up, reason) => { calls.push(reason); if (fail) throw Object.assign(new Error("rpc"), { code: "SEND_FAILED" }); return HASH; } };
    const badge = { getAttestation: async () => ({ status: 1n }) };
    for (let i = 0; i < 3; i++) await processInvalidations({ db, minter, badge, now: () => now });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE kind = 'invalidate_failed'").get().n, 1);
    fail = false;
    assert.equal((await processInvalidations({ db, minter, badge, now: () => now })).done, 1);
    assert.deepEqual([...new Set(calls)], ["INVALIDATED"]);
    assert.equal(db.prepare("SELECT status FROM links").get().status, "invalidated");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM pending_invalidations").get().n, 0);
  });

  it("a badge already renounced on-chain is just closed", async () => {
    const db = withLink();
    const minter = { invalidate: async () => { throw Object.assign(new Error("revert"), { code: "SIMULATION_REVERTED" }); } };
    const badge = { getAttestation: async () => ({ status: 2n }) };
    assert.equal((await processInvalidations({ db, minter, badge, now: () => now })).closed, 1);
    assert.equal(db.prepare("SELECT status FROM links").get().status, "invalidated");
  });
});
