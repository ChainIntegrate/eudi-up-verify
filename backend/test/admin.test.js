// Admin API (A1-A5): owner-only login with a one-time challenge, session cookie, calldata for the owner UP,
// audit + e-mail of every action. Chain and UP checks are faked; the browser test covers the real chain.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { Interface, Wallet, decodeBytes32String, getAddress, verifyMessage } from "ethers";
import { LSP4_METADATA_KEY, createAdmin, metadataValue } from "../src/admin.js";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";

const OWNER = getAddress("0x83cbe526d949a3aaab4ef9a03e48dd862e81472c");
const OTHER = getAddress("0x4a2605796e0d91a9667d6e30365aeec384c48c27");
const ATTESTER = getAddress("0x8f42e3a2a23de54a8dfa94502f344cb81062723a");
const controller = Wallet.createRandom();
const iface = new Interface([
  "function approveException(bytes32,uint8)",
  "function revoke(address,bytes32)",
  "function reinstate(address)",
  "function setAttester(address)",
  "function setData(bytes32,bytes)",
]);

const cfg = {
  network: "luksoTestnet",
  deployment: { address: "0x6A525B5662EF905f3DD90F7139DC3a702b1371BA", deployBlock: 8745039, chainId: 4201 },
  publicOrigin: "https://up-cie-link.example",
  statementOrigin: "https://up-cie-link.example",
  upSignatureWindowSec: 300,
  statementTtlSec: 900,
};
// the controller's EIP-191 signatures are valid for every UP (enough to test who is the owner)
const upChecker = { isUniversalProfile: async () => true, isValidUpSignature: async (_up, msg, sig) => { try { return verifyMessage(msg, sig) === controller.address; } catch { return false; } } };

describe("admin API", () => {
  let dir, metadataFile, db, server, base, now, chain;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "admin-"));
    metadataFile = path.join(dir, "badge.json");
    writeFileSync(metadataFile, '{"LSP4Metadata":{"name":"UP CIE Link"}}\n');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    now = Date.parse("2026-10-15T10:00:00Z");
    db = openDb(":memory:");
    chain = {
      ownerAddr: OWNER,
      owner: async () => chain.ownerAddr,
      attester: async () => ATTESTER,
      getData: async () => "0x",
      getAttestation: async () => ({ status: 1n, primary: true, verifiedAt: 1n, expiresAt: 2n }),
      exceptionOf: async () => 0n,
      balance: async () => 5n * 10n ** 18n,
    };
    const admin = createAdmin({ db, cfg, upChecker, chain, minterAddress: ATTESTER, metadataFile, clock: () => now });
    server = createApp({ db, cfg, upChecker, admin, clock: () => now }).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}/api/admin`;
  });
  const close = () => new Promise((r) => server.close(r));

  const post = (p, body, headers = {}) =>
    fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", Origin: cfg.publicOrigin, ...headers }, body: JSON.stringify(body ?? {}) });
  async function login(up = OWNER) {
    const c = await (await post("/challenge", { up })).json();
    const res = await post("/login", { id: c.id, signature: await controller.signMessage(c.text) });
    const setCookie = res.headers.get("set-cookie") ?? "";
    return { res, cookie: setCookie.split(";")[0], setCookie, challenge: c };
  }

  it("A1: only the on-chain owner gets a challenge; the challenge names site, chain, contract and UP", async () => {
    assert.equal((await post("/challenge", { up: OTHER })).status, 403);
    assert.equal((await post("/challenge", { up: "nope" })).status, 400);
    const c = await (await post("/challenge", { up: OWNER.toLowerCase() })).json();
    for (const line of ["up-cie-link admin login v1", `Origin: ${cfg.publicOrigin}`, "Chain-Id: 4201", `Contract: ${cfg.deployment.address}`, `Universal-Profile: ${OWNER}`]) {
      assert.ok(c.text.includes(line), line);
    }
    await close();
  });

  it("A1: login sets an HttpOnly SameSite=Strict Secure cookie; the challenge is single use and expires", async () => {
    const { res, setCookie, challenge } = await login();
    assert.equal(res.status, 200);
    assert.match(setCookie, /^ucl_admin=[\w-]{43}; Path=\/api\/admin; HttpOnly; SameSite=Strict; Max-Age=1800; Secure$/);
    // replay of the same challenge
    assert.equal((await post("/login", { id: challenge.id, signature: await controller.signMessage(challenge.text) })).status, 401);
    // expired challenge
    const c = await (await post("/challenge", { up: OWNER })).json();
    now += 5 * 60_000 + 1;
    assert.equal((await post("/login", { id: c.id, signature: await controller.signMessage(c.text) })).status, 401);
    // wrong signer
    const c2 = await (await post("/challenge", { up: OWNER })).json();
    assert.equal((await post("/login", { id: c2.id, signature: await Wallet.createRandom().signMessage(c2.text) })).status, 401);
    await close();
  });

  it("A1: without a valid session nothing is returned; sessions end after 30 minutes and at logout", async () => {
    assert.equal((await fetch(`${base}/status`)).status, 401);
    assert.equal((await fetch(`${base}/status`, { headers: { Cookie: "ucl_admin=forged" } })).status, 401);
    const { cookie } = await login();
    assert.equal((await fetch(`${base}/status`, { headers: { Cookie: cookie } })).status, 200);
    now += 30 * 60_000 + 1;
    assert.equal((await fetch(`${base}/status`, { headers: { Cookie: cookie } })).status, 401);
    const second = await login();
    assert.equal((await post("/logout", {}, { Cookie: second.cookie })).status, 200);
    assert.equal((await fetch(`${base}/status`, { headers: { Cookie: second.cookie } })).status, 401);
    await close();
  });

  it("A1: an owner change on-chain blocks the login of the old owner", async () => {
    const c = await (await post("/challenge", { up: OWNER })).json();
    chain.ownerAddr = OTHER;
    assert.equal((await post("/login", { id: c.id, signature: await controller.signMessage(c.text) })).status, 403);
    await close();
  });

  it("state-changing requests from another origin are refused", async () => {
    const { cookie } = await login();
    const r = await post("/tx", { action: "stopMinting" }, { Cookie: cookie, Origin: "https://evil.example" });
    assert.equal(r.status, 403);
    await close();
  });

  it("A2: status shows chain, queue, metadata comparison", async () => {
    const { cookie } = await login();
    const s = await (await fetch(`${base}/status`, { headers: { Cookie: cookie } })).json();
    assert.equal(s.owner, OWNER);
    assert.equal(s.attester, ATTESTER);
    assert.equal(s.mintingStopped, false);
    assert.equal(s.attesterBalance, "5.0");
    assert.equal(s.metadata.upToDate, false);
    assert.equal(s.metadata.expected, metadataValue('{"LSP4Metadata":{"name":"UP CIE Link"}}\n', "https://up-cie-link.example/metadata/badge.json"));
    await close();
  });

  it("A3: calldata for every owner action, validated", async () => {
    const { cookie } = await login();
    const tx = async (action, args) => post("/tx", { action, args }, { Cookie: cookie });
    const ticket = `0x${"ab".repeat(32)}`;
    const decode = async (r) => {
      const body = await r.json();
      assert.equal(body.to, cfg.deployment.address);
      return iface.parseTransaction({ data: body.data });
    };
    let p = await decode(await tx("approveException", { ticket, maxUps: 2 }));
    assert.deepEqual([p.name, p.args[0], Number(p.args[1])], ["approveException", ticket, 2]);
    p = await decode(await tx("approveException", { ticket, maxUps: 0 }));
    assert.equal(Number(p.args[1]), 0);
    p = await decode(await tx("revoke", { up: OTHER, reason: "ABUSE" }));
    assert.deepEqual([p.name, p.args[0], decodeBytes32String(p.args[1])], ["revoke", OTHER, "ABUSE"]);
    p = await decode(await tx("reinstate", { up: OTHER }));
    assert.equal(p.name, "reinstate");
    p = await decode(await tx("stopMinting"));
    assert.deepEqual([p.name, p.args[0]], ["setAttester", "0x0000000000000000000000000000000000000000"]);
    p = await decode(await tx("restoreAttester"));
    assert.deepEqual([p.name, p.args[0]], ["setAttester", ATTESTER]);
    p = await decode(await tx("setMetadata"));
    assert.deepEqual([p.name, p.args[0]], ["setData", LSP4_METADATA_KEY]);
    for (const [action, args] of [["revoke", { up: OTHER, reason: "WHATEVER" }], ["approveException", { ticket: "0x12", maxUps: 2 }], ["approveException", { ticket, maxUps: 300 }], ["transferOwnership", {}]]) {
      assert.equal((await tx(action, args)).status, 400, action);
    }
    await close();
  });

  it("A2/A5: rejecting an exception and logging an action write the audit and queue an e-mail", async () => {
    const { cookie } = await login();
    db.prepare("INSERT INTO persons (person_key, created_at) VALUES (?, ?)").run(Buffer.alloc(32, 1), now);
    db.prepare("INSERT INTO exception_requests VALUES ('0xt', ?, 'pending', ?)").run(Buffer.alloc(32, 1), now);
    const list = await (await fetch(`${base}/exceptions`, { headers: { Cookie: cookie } })).json();
    assert.equal(list[0].ticket, "0xt");
    assert.equal((await post("/exceptions/0xt/reject", {}, { Cookie: cookie })).status, 200);
    assert.equal(db.prepare("SELECT status FROM exception_requests").get().status, "rejected");
    const hash = `0x${"cd".repeat(32)}`;
    assert.equal((await post("/log", { action: "stopMinting", txHash: hash }, { Cookie: cookie })).status, 200);
    const events = db.prepare("SELECT event FROM audit ORDER BY id").all().map((r) => r.event);
    assert.deepEqual(events, ["admin_login", "admin_exception_rejected", "admin_stopMinting"]);
    const mails = db.prepare("SELECT severity, subject FROM notifications ORDER BY id").all();
    assert.deepEqual(mails.map((m) => m.severity), ["event", "problem"]);
    assert.match(mails[1].subject, /stopMinting/);
    assert.equal((await post("/log", { action: "x; DROP", txHash: hash }, { Cookie: cookie })).status, 400);
    await close();
  });
});
