import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Wallet, getAddress, verifyMessage } from "ethers";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { buildStatementText } from "../src/statements.js";

const UP = getAddress("0x83cbe526d949a3aaab4ef9a03e48dd862e81472c");
const controller = Wallet.createRandom();
const stranger = Wallet.createRandom();

const cfg = {
  network: "luksoTestnet",
  deployment: { address: "0x056a7e721fbd727862d767CC44C48Bf2a7177892", deployBlock: 8737860, chainId: 4201 },
  publicOrigin: "https://up-cie-link.example",
  statementOrigin: "https://up-cie-link.example",
  upSignatureWindowSec: 300,
  statementTtlSec: 900,
  allowCadesUpload: true,
};

// Fake chain: only UP is a Universal Profile; its controller's EIP-191 signatures are valid (real ECDSA recovery).
const upChecker = {
  isUniversalProfile: async (a) => getAddress(a) === UP,
  isValidUpSignature: async (up, message, sig) => {
    try {
      return getAddress(up) === UP && verifyMessage(message, sig) === controller.address;
    } catch {
      return false;
    }
  },
};

describe("API: statements and UP signature", () => {
  let server, base, now, db;
  const clock = () => now;

  beforeEach(async () => {
    now = Date.parse("2026-10-15T10:00:00Z");
    db = openDb(":memory:");
    server = createApp({ db, cfg, upChecker, clock }).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server?.close());
  const close = () => new Promise((r) => server.close(r));

  const post = (path, body, headers = {}) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("creates a statement with the exact text to sign", async () => {
    const res = await post("/api/statements", { up: UP.toLowerCase(), mode: "link" });
    assert.equal(res.status, 201);
    const s = await res.json();
    assert.equal(s.status, "pending_up");
    assert.equal(s.up, UP);
    assert.match(s.text, /^up-cie-link statement v1\n/);
    assert.ok(s.text.includes(`Universal-Profile: ${UP}\n`));
    assert.ok(s.text.includes("Chain-Id: 4201\n"));
    assert.ok(s.text.includes(`Contract: ${cfg.deployment.address}\n`));
    assert.ok(s.text.includes("Mode: link\n"));
    assert.ok(s.text.includes("Issued-At: 2026-10-15T10:00:00Z\nExpires-At: 2026-10-15T10:15:00Z\n"));
    assert.ok(!s.text.endsWith("\n"));
    assert.equal(s.upSignatureDeadline, "2026-10-15T10:05:00Z");
    // the text is rebuilt identically on read
    const again = await (await fetch(`${base}/api/statements/${s.id}`)).json();
    assert.equal(again.text, s.text);
    // the file to sign with CieSign has exactly the same bytes
    const file = await fetch(`${base}/api/statements/${s.id}/file`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get("content-disposition"), /^attachment; filename="up-cie-link-[0-9a-f]{8}\.txt"$/);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(s.text, "ascii"));
    assert.equal((await fetch(`${base}/api/statements/nope/file`)).status, 404);
    await close();
  });

  it("rejects invalid input and non-UP addresses", async () => {
    assert.equal((await post("/api/statements", { up: "0x123" })).status, 400);
    assert.equal((await (await post("/api/statements", { up: UP, mode: "steal" })).json()).error, "INVALID_MODE");
    const r = await post("/api/statements", { up: stranger.address });
    assert.equal((await r.json()).error, "NOT_A_UNIVERSAL_PROFILE");
    await close();
  });

  it("accepts the UP signature once and moves to pending_cie", async () => {
    const s = await (await post("/api/statements", { up: UP })).json();
    const signature = await controller.signMessage(s.text);
    const ok = await post(`/api/statements/${s.id}/up-signature`, { signature });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).status, "pending_cie");
    const replay = await post(`/api/statements/${s.id}/up-signature`, { signature });
    assert.equal(replay.status, 409);
    await close();
  });

  it("rejects signatures from another key or over another text", async () => {
    const s = await (await post("/api/statements", { up: UP })).json();
    const wrongKey = await stranger.signMessage(s.text);
    assert.equal((await (await post(`/api/statements/${s.id}/up-signature`, { signature: wrongKey })).json()).error, "INVALID_UP_SIGNATURE");
    const wrongText = await controller.signMessage(s.text + " ");
    assert.equal((await (await post(`/api/statements/${s.id}/up-signature`, { signature: wrongText })).json()).error, "INVALID_UP_SIGNATURE");
    assert.equal((await (await post(`/api/statements/${s.id}/up-signature`, { signature: 42 })).json()).error, "INVALID_SIGNATURE");
    await close();
  });

  it("enforces the 5-minute UP window and the statement expiry", async () => {
    const s = await (await post("/api/statements", { up: UP })).json();
    const signature = await controller.signMessage(s.text);
    now += 5 * 60_000 + 1;
    assert.equal((await (await post(`/api/statements/${s.id}/up-signature`, { signature })).json()).error, "UP_SIGNATURE_WINDOW_EXPIRED");
    now += 15 * 60_000;
    assert.equal((await (await post(`/api/statements/${s.id}/up-signature`, { signature })).json()).error, "STATEMENT_EXPIRED");
    assert.equal((await (await fetch(`${base}/api/statements/${s.id}`)).json()).status, "expired");
    await close();
  });

  it("a signature for one statement does not work on another (nonce)", async () => {
    const s1 = await (await post("/api/statements", { up: UP })).json();
    const s2 = await (await post("/api/statements", { up: UP })).json();
    assert.notEqual(s1.text, s2.text);
    const sig1 = await controller.signMessage(s1.text);
    assert.equal((await post(`/api/statements/${s2.id}/up-signature`, { signature: sig1 })).status, 400);
    await close();
  });

  it("CORS only for the configured origin", async () => {
    const good = await fetch(`${base}/api/config`, { headers: { Origin: cfg.publicOrigin } });
    assert.equal(good.headers.get("access-control-allow-origin"), cfg.publicOrigin);
    const bad = await fetch(`${base}/api/config`, { headers: { Origin: "https://evil.example" } });
    assert.equal(bad.headers.get("access-control-allow-origin"), null);
    const c = await good.json();
    assert.deepEqual(c.cieChannels, ["cades", "raw"]);
    assert.equal(c.contract, cfg.deployment.address);
    await close();
  });

  it("rate-limits statement creation (10 per minute per IP)", async () => {
    for (let i = 0; i < 10; i++) assert.equal((await post("/api/statements", { up: UP })).status, 201);
    assert.equal((await post("/api/statements", { up: UP })).status, 429);
    now += 60_000;
    assert.equal((await post("/api/statements", { up: UP })).status, 201);
    await close();
  });

  it("rejects oversized bodies and unknown routes with stable codes", async () => {
    const big = await post("/api/statements", { up: UP, pad: "x".repeat(70_000) });
    assert.equal(big.status, 413);
    assert.equal((await (await fetch(`${base}/api/nope`)).json()).error, "NOT_FOUND");
    assert.equal((await (await fetch(`${base}/api/statements/unknown`)).json()).error, "NOT_FOUND");
    await close();
  });

  it("stores no statement text and no signature in the database", async () => {
    const s = await (await post("/api/statements", { up: UP })).json();
    const signature = await controller.signMessage(s.text);
    await post(`/api/statements/${s.id}/up-signature`, { signature });
    const dump = JSON.stringify(db.prepare("SELECT * FROM statements").all()) + JSON.stringify(db.prepare("SELECT * FROM audit").all());
    assert.ok(!dump.includes(signature.slice(2, 40)));
    assert.ok(!dump.includes("I declare"));
    await close();
  });
});

describe("statement text", () => {
  it("is ASCII-only and rejects other characters", () => {
    const base = { origin: "https://x", chainId: 42, contract: "0x0", up: "0x1", mode: "link", nonce: "n", issuedAt: 0, expiresAt: 1000 };
    assert.ok(buildStatementText(base));
    assert.throws(() => buildStatementText({ ...base, origin: "https://città" }));
  });
});
