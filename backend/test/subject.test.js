// UCL-31: data-subject requests are executed only with a signature of the UP.
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import { Wallet, getAddress, verifyMessage } from "ethers";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { applyLink } from "../src/linking.js";
import { createSubjectRequests } from "../src/subject.js";

const UP = getAddress("0x83cbe526d949a3aaab4ef9a03e48dd862e81472c");
const UP2 = getAddress("0x1111111111111111111111111111111111111111");
const controller = Wallet.createRandom();
const stranger = Wallet.createRandom();

const cfg = {
  network: "luksoTestnet",
  deployment: { address: "0x056a7e721fbd727862d767CC44C48Bf2a7177892", deployBlock: 8737860, chainId: 4201 },
  publicOrigin: "https://up-cie-link.example",
  upSignatureWindowSec: 300,
  statementTtlSec: 900,
};
const upChecker = {
  isUniversalProfile: async () => true,
  isValidUpSignature: async (up, message, sig) => {
    try {
      return getAddress(up) === UP && verifyMessage(message, sig) === controller.address;
    } catch {
      return false;
    }
  },
};

describe("UCL-31: self-service data-subject requests", () => {
  let server, base, now, db;
  const clock = () => now;
  const post = async (path, body) => {
    const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const challenge = async (up, action) => (await post("/api/subject/challenge", { up, action })).body;

  beforeEach(async () => {
    server?.close();
    now = Date.parse("2026-10-17T10:00:00Z");
    db = openDb(":memory:");
    const personKey = randomBytes(32);
    applyLink(db, { up: UP, personKey, primary: true, expiresAtMs: now + 1e10, certRefEnc: null, txHash: "0x01" }, now);
    applyLink(db, { up: UP2, personKey, primary: false, expiresAtMs: now + 1e10, certRefEnc: null, txHash: "0x02" }, now);
    const subject = createSubjectRequests({ db, cfg, upChecker, clock });
    server = createApp({ db, cfg, upChecker, subject, clock }).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server?.close());

  it("exports every UP of the person when the UP signs the request, once", async () => {
    const c = await challenge(UP.toLowerCase(), "export");
    assert.match(c.text, /^up-cie-link data request v1\n/);
    assert.ok(c.text.includes(`Universal-Profile: ${UP}\nRequest: export\n`));
    const signature = await controller.signMessage(c.text);
    const r = await post("/api/subject/request", { ...c, signature });
    assert.equal(r.status, 200);
    assert.equal(r.body.action, "export");
    assert.deepEqual(r.body.data.links.map((l) => l.up).sort(), [UP, UP2].sort());
    // single use
    assert.equal((await post("/api/subject/request", { ...c, signature })).body.error, "REQUEST_EXPIRED");
  });

  it("refuses a signature by someone else, a forged text and an expired request", async () => {
    const c = await challenge(UP, "export");
    const bad = await post("/api/subject/request", { ...c, signature: await stranger.signMessage(c.text) });
    assert.deepEqual(bad, { status: 400, body: { error: "INVALID_UP_SIGNATURE" } });
    // the action cannot be changed after the challenge: the tag no longer matches
    const forged = c.text.replace("Request: export", "Request: erase");
    const f = await post("/api/subject/request", { text: forged, tag: c.tag, signature: await controller.signMessage(forged) });
    assert.deepEqual(f, { status: 400, body: { error: "INVALID_REQUEST" } });
    now += 5 * 60_000 + 1000;
    const late = await post("/api/subject/request", { ...c, signature: await controller.signMessage(c.text) });
    assert.deepEqual(late, { status: 410, body: { error: "REQUEST_EXPIRED" } });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM links").get().n, 2);
  });

  it("erases the person and queues the invalidations when the UP signs", async () => {
    const c = await challenge(UP, "erase");
    const r = await post("/api/subject/request", { ...c, signature: await controller.signMessage(c.text) });
    assert.equal(r.status, 200);
    assert.deepEqual({ ...r.body, ups: r.body.ups.sort() }, { action: "erase", ups: [UP, UP2].sort(), invalidations: 2 });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM links").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM persons").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM pending_invalidations").get().n, 2);
    // a second request finds nothing
    const c2 = await challenge(UP, "export");
    assert.deepEqual(await post("/api/subject/request", { ...c2, signature: await controller.signMessage(c2.text) }), { status: 404, body: { error: "NO_DATA" } });
  });

  it("rejects bad input on the challenge", async () => {
    assert.deepEqual(await post("/api/subject/challenge", { up: "0x12", action: "export" }), { status: 400, body: { error: "INVALID_UP" } });
    assert.deepEqual(await post("/api/subject/challenge", { up: UP, action: "delete" }), { status: 400, body: { error: "INVALID_ACTION" } });
  });
});
