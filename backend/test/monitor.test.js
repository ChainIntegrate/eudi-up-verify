// UCL-06 / UCL-22: monitor findings on the minting pipeline and the revocation recheck; no private key needed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { kvSet, openDb } from "../src/db.js";
import { applyLink } from "../src/linking.js";
import { startMint } from "../src/mints.js";
import { collectFindings, monitorConfig } from "../src/monitor.js";

const UP = "0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C";
const HOUR = 3_600_000;
const now = Date.parse("2026-10-15T12:00:00Z");
const cfg = { port: 1, deployment: { chainId: 4201, address: UP }, attesterAddress: UP, minAttesterBalance: 0n, backupDir: null, trustDir: null, retryDelayMs: 1, healthRetryDelayMs: 1 };
// RPC down on purpose: only the database-side findings matter here
const provider = { send: async () => { throw new Error("down"); } };
const fetchHealth = async () => ({ ok: true, indexer: { at: now } });
const ids = async (db) => (await collectFindings({ cfg, provider, db, fetchHealth, now })).map((f) => f.id);

describe("monitor: database-side findings", () => {
  it("a backend restarting during the check is not an alarm (second attempt)", async () => {
    let calls = 0;
    const flaky = async () => { if (calls++ === 0) throw new Error("ECONNREFUSED"); return { ok: true, indexer: { at: now } }; };
    const found = (await collectFindings({ cfg, provider, db: null, fetchHealth: flaky, now })).map((f) => f.id);
    assert.ok(!found.includes("backend_down"));
    const down = async () => { throw new Error("ECONNREFUSED"); };
    assert.ok((await collectFindings({ cfg, provider, db: null, fetchHealth: down, now })).some((f) => f.id === "backend_down"));
  });

  it("UCL-08: a signer that is not ready is a problem", async () => {
    const health = async () => ({ ok: true, indexer: { at: now }, signer: { ready: false, error: "PEPPER_MISMATCH" } });
    const f = (await collectFindings({ cfg, provider, db: null, fetchHealth: health, now })).find((x) => x.id === "signer_not_ready");
    assert.match(f.text, /PEPPER_MISMATCH/);
    const ok = async () => ({ ok: true, indexer: { at: now }, signer: { ready: true, error: null } });
    assert.ok(!(await collectFindings({ cfg, provider, db: null, fetchHealth: ok, now })).some((x) => x.id === "signer_not_ready"));
  });

  it("revocation recheck: never run, stale, with errors", async () => {
    const db = openDb(":memory:");
    applyLink(db, { up: UP, personKey: randomBytes(32), primary: true, expiresAtMs: now + 1e10, certRefEnc: null, txHash: "0x1" }, now);
    assert.ok((await ids(db)).includes("revocation_stale"));
    kvSet(db, "revocation", { at: now - 2 * HOUR, checked: 1, good: 1, revoked: 0, unavailable: 0, errors: 0 });
    assert.ok(!(await ids(db)).includes("revocation_stale"));
    kvSet(db, "revocation", { at: now - 40 * HOUR, checked: 1, good: 0, revoked: 0, unavailable: 0, errors: 1 });
    const found = await ids(db);
    assert.ok(found.includes("revocation_stale") && found.includes("revocation_errors"));
  });

  it("minting pipeline: open mints, stuck queue, failing invalidations, repeated failures", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO statements (id, up, mode, nonce, text_sha256, issued_at, expires_at, status) VALUES ('s', ?, 'link', 'n', 'h', ?, ?, 'queued')")
      .run(UP, now - HOUR, now);
    startMint(db, { statementId: "m", up: UP, personKey: randomBytes(32), primary: true, expiresAt: now + 1e10 }, now - 20 * 60_000);
    db.prepare("INSERT INTO pending_invalidations (up, reason, attempts, created_at) VALUES (?, 'MIGRATED', 3, ?)").run(UP, now);
    for (let i = 0; i < 3; i++) db.prepare("INSERT INTO audit (ts, event, up) VALUES (?, 'mint_failed', ?)").run(now - HOUR, UP);
    const found = await ids(db);
    for (const id of ["mints_open", "queue_stuck", "invalidations_failing", "mint_failures"]) assert.ok(found.includes(id), id);
  });

  it("UCL-22: the monitor config needs the attester address, never the private key", () => {
    const base = { NETWORK: "luksoTestnet", RPC_URL: "http://x", PORT: "1", DB_PATH: "/tmp/x.db" };
    assert.throws(() => monitorConfig({ ...base, ATTESTER_PRIVATE_KEY: `0x${"11".repeat(32)}` }), /ATTESTER_ADDRESS/);
    assert.equal(monitorConfig({ ...base, ATTESTER_ADDRESS: UP }).attesterAddress, UP);
  });
});
