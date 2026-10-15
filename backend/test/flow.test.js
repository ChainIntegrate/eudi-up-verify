// End-to-end flow through the HTTP API with a fake CIE PKI, a fake chain and a recording minter:
// statement -> UP signature -> CIE signature (CAdES or raw) -> uniqueness rules -> attest.
import assert from "node:assert/strict";
import { randomBytes, sign } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Wallet, getAddress, verifyMessage } from "ethers";
import { createApp } from "../src/app.js";
import { parseCertificate } from "../src/cie/pki.js";
import { trustStoreFromCerts } from "../src/cie/trust.js";
import { createCieFlow } from "../src/cieFlow.js";
import { openDb } from "../src/db.js";
import { createSerialQueue } from "../src/queue.js";
import { decryptCertRef } from "../src/secrets.js";
import { FAKE_NAME, FAKE_SURNAME, FAKE_TAX_CODE, createFakePki } from "./helpers/fake-pki.js";

const OTHER_TAX_CODE = "VRDLGU75C41F205X";
const controller = Wallet.createRandom();
const UPS = Array.from({ length: 4 }, () => getAddress(Wallet.createRandom().address));
const [UP1, UP2, UP3, UP4] = UPS;

const cfg = {
  network: "luksoTestnet",
  deployment: { address: "0x056a7e721fbd727862d767CC44C48Bf2a7177892", deployBlock: 1, chainId: 4201 },
  publicOrigin: "https://up-cie-link.example",
  statementOrigin: "https://up-cie-link.example",
  upSignatureWindowSec: 300,
  statementTtlSec: 900,
  allowCadesUpload: true,
};

const upChecker = {
  isUniversalProfile: async (a) => UPS.includes(getAddress(a)),
  isValidUpSignature: async (up, msg, sig) => {
    try {
      return UPS.includes(getAddress(up)) && verifyMessage(msg, sig) === controller.address;
    } catch {
      return false;
    }
  },
};

describe("CIE flow: verification, uniqueness, minting", () => {
  let pki, other, trust, db, server, base, minter, badge, queue;
  const pepper = randomBytes(32);
  const certRefKey = randomBytes(32);

  before(() => {
    pki = createFakePki();
    other = pki.issueHolder(OTHER_TAX_CODE); // second person under the same CA
    trust = trustStoreFromCerts([parseCertificate(pki.rootPem), parseCertificate(pki.subPem)], [pki.rootSha256]);
  });
  after(() => pki.cleanup());

  beforeEach(async () => {
    db = openDb(":memory:");
    queue = createSerialQueue();
    minter = {
      calls: [],
      fail: false,
      async attest(up, expiresAtSec, primary) {
        if (this.fail) throw new Error("rpc down");
        this.calls.push(["attest", up, primary]);
        return `0x${randomBytes(32).toString("hex")}`;
      },
      async invalidate(up, reason) {
        this.calls.push(["invalidate", up, reason]);
        return `0x${randomBytes(32).toString("hex")}`;
      },
    };
    badge = { exceptions: new Map(), exceptionOf: async (t) => BigInt(badge.exceptions.get(t) ?? 0) };
    const cieFlow = createCieFlow({ db, cfg, trust, pepper, certRefKey, badge, minter, queue, ocspTransport: pki.ocspTransport });
    server = createApp({ db, cfg, upChecker, cieFlow }).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterEach(() => new Promise((r) => server.close(r)));

  const json = (path, body) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const status = async (id) => (await fetch(`${base}/api/statements/${id}`)).json();

  /** Creates a statement for `up`, signs it with the UP; returns {id, text}. */
  async function signedStatement(up, mode = "link") {
    const s = await (await json("/api/statements", { up, mode })).json();
    const r = await json(`/api/statements/${s.id}/up-signature`, { signature: await controller.signMessage(s.text) });
    assert.equal(r.status, 200);
    return s;
  }
  async function cades(s, holder = "holder") {
    const p7m = pki.signCades(Buffer.from(s.text, "ascii"), { holder });
    return fetch(`${base}/api/statements/${s.id}/cie-cades`, { method: "POST", headers: { "Content-Type": "application/pkcs7-mime" }, body: p7m });
  }
  async function link(up, mode = "link", holder = "holder") {
    const s = await signedStatement(up, mode);
    const r = await cades(s, holder);
    assert.equal(r.status, 202, `submission refused: ${JSON.stringify(await r.clone().json())}`);
    await queue.idle();
    return status(s.id);
  }

  it("CAdES: verifies, mints a primary badge and records only pseudonymous data", async () => {
    const st = await link(UP1);
    assert.equal(st.status, "done");
    assert.match(st.txHash, /^0x[0-9a-f]{64}$/);
    assert.deepEqual(minter.calls, [["attest", UP1, true]]);
    const linkRow = db.prepare("SELECT * FROM links WHERE up = ?").get(UP1);
    assert.equal(linkRow.is_primary, 1);
    assert.equal(linkRow.status, "valid");
    const ref = decryptCertRef(certRefKey, linkRow.cert_ref_enc);
    assert.match(ref.serialHex, /^[0-9a-f]+$/);
    // privacy: no tax code, name or surname anywhere in the database
    const dump = ["statements", "persons", "links", "exception_requests", "audit"]
      .map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all(), (_k, v) => (Buffer.isBuffer(v) ? v.toString("latin1") : v)))
      .join("");
    for (const v of [FAKE_TAX_CODE, FAKE_NAME, FAKE_SURNAME]) assert.ok(!dump.includes(v), `${v} found in DB`);
  });

  it("raw channel (Android app): signature over the statement + certificate", async () => {
    const s = await signedStatement(UP1);
    const { pem, keyPem } = pki.holderFiles();
    const signature = sign("sha256", Buffer.from(s.text, "ascii"), keyPem).toString("base64");
    const certificate = Buffer.from(pem).toString("base64");
    const r = await json(`/api/statements/${s.id}/cie-raw`, { certificate, signature });
    assert.equal(r.status, 202);
    await queue.idle();
    assert.equal((await status(s.id)).status, "done");
  });

  it("refuses CIE before the UP signature, twice, and when the channel is disabled", async () => {
    const s = await (await json("/api/statements", { up: UP1 })).json();
    assert.equal((await (await cades(s)).json()).error, "UP_SIGNATURE_REQUIRED");
    const s2 = await signedStatement(UP1);
    assert.equal((await cades(s2)).status, 202);
    assert.equal((await (await cades(s2)).json()).error, "ALREADY_SUBMITTED");
    cfg.allowCadesUpload = false;
    try {
      const s3 = await signedStatement(UP2);
      assert.equal((await (await cades(s3)).json()).error, "CHANNEL_DISABLED");
    } finally {
      cfg.allowCadesUpload = true;
    }
    await queue.idle();
  });

  it("revoked certificate and unreachable OCSP are refused (fail-closed)", async () => {
    pki.setStatus("revoked");
    try {
      const s = await signedStatement(UP1);
      const r = await cades(s);
      assert.equal((await r.json()).error, "CERT_REVOKED");
      assert.equal((await status(s.id)).status, "failed");
    } finally {
      pki.setStatus("good");
    }
    assert.equal(minter.calls.length, 0);
  });

  it("a signature over another statement is refused", async () => {
    const s1 = await signedStatement(UP1);
    const s2 = await signedStatement(UP2);
    const p7m = pki.signCades(Buffer.from(s1.text, "ascii"));
    const r = await fetch(`${base}/api/statements/${s2.id}/cie-cades`, { method: "POST", body: p7m });
    assert.equal((await r.json()).error, "CONTENT_MISMATCH");
  });

  it("same person, same UP, mode link: renewal in place", async () => {
    await link(UP1);
    const st = await link(UP1);
    assert.equal(st.status, "done");
    assert.deepEqual(minter.calls, [["attest", UP1, true], ["attest", UP1, true]]);
  });

  it("same person, second UP, mode link: refused (migration or exception required)", async () => {
    await link(UP1);
    const st = await link(UP2);
    assert.equal(st.status, "failed");
    assert.equal(st.errorCode, "MIGRATION_OR_EXCEPTION_REQUIRED");
    assert.equal(minter.calls.length, 1);
  });

  it("migration: invalidates the old primary and makes the new UP primary", async () => {
    await link(UP1);
    const st = await link(UP2, "migrate");
    assert.equal(st.status, "done");
    assert.deepEqual(minter.calls.slice(1), [["invalidate", UP1, "MIGRATED"], ["attest", UP2, true]]);
    assert.equal(db.prepare("SELECT status FROM links WHERE up = ?").get(UP1).status, "invalidated");
    // the old UP can no longer be renewed with mode link: the person has a primary elsewhere
    assert.equal((await link(UP1)).errorCode, "MIGRATION_OR_EXCEPTION_REQUIRED");
  });

  it("exception: ticket first, then approval on-chain, then limited additional UPs", async () => {
    await link(UP1);
    const first = await link(UP2, "additional");
    assert.equal(first.errorCode, "EXCEPTION_REQUIRED");
    assert.match(first.exceptionTicket, /^0x[0-9a-f]{64}$/);

    const pending = await link(UP2, "additional");
    assert.equal(pending.errorCode, "EXCEPTION_PENDING");
    assert.equal(pending.exceptionTicket, first.exceptionTicket);

    badge.exceptions.set(first.exceptionTicket, 2); // owner calls approveException(ticket, 2)
    const ok = await link(UP2, "additional");
    assert.equal(ok.status, "done");
    assert.deepEqual(minter.calls.at(-1), ["attest", UP2, false]);

    const third = await link(UP3, "additional");
    assert.equal(third.errorCode, "EXCEPTION_LIMIT_REACHED");

    // UCL-21: the owner withdraws the exception on-chain
    badge.exceptions.set(first.exceptionTicket, 0);
    assert.equal((await link(UP3, "additional")).errorCode, "EXCEPTION_WITHDRAWN");
  });

  it("additional without a primary link is refused", async () => {
    assert.equal((await link(UP1, "additional")).errorCode, "NO_PRIMARY_LINK");
  });

  it("a UP linked to one person cannot be taken by another person", async () => {
    await link(UP1, "link", "holder");
    const st = await link(UP1, "link", other);
    assert.equal(st.errorCode, "UP_LINKED_TO_ANOTHER_PERSON");
    // the other person can link a different UP
    assert.equal((await link(UP4, "link", other)).status, "done");
  });

  it("minting failure is reported and leaves no link", async () => {
    minter.fail = true;
    const st = await link(UP1);
    assert.equal(st.status, "failed");
    assert.equal(st.errorCode, "MINT_FAILED");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM links").get().n, 0);
  });
});
