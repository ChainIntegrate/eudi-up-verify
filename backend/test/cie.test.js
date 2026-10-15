import assert from "node:assert/strict";
import { sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { CieError, parseCertificate } from "../src/cie/pki.js";
import { loadTrustStore, trustStoreFromCerts } from "../src/cie/trust.js";
import { ocspStatus } from "../src/cie/ocsp.js";
import { verifyCieCades, verifyCieRaw } from "../src/cie/verify.js";
import { FAKE_NAME, FAKE_SURNAME, FAKE_TAX_CODE, createFakePki } from "./helpers/fake-pki.js";

const statement = Buffer.from("up-cie-link statement v1\nUniversal-Profile: 0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C\nNonce: abc", "ascii");

const rejectsWith = (promise, code) =>
  assert.rejects(promise, (e) => {
    assert.ok(e instanceof CieError, `expected CieError, got ${e}`);
    assert.equal(e.code, code);
    // error messages never carry personal data
    for (const v of [FAKE_TAX_CODE, FAKE_NAME, FAKE_SURNAME]) assert.ok(!String(e.message).includes(v));
    return true;
  });

describe("CIE verification", () => {
  let pki, ctx;

  before(() => {
    pki = createFakePki();
    const certs = [parseCertificate(pki.rootPem), parseCertificate(pki.subPem)];
    ctx = { trust: trustStoreFromCerts(certs, [pki.rootSha256]), ocspTransport: pki.ocspTransport };
  });
  after(() => pki.cleanup());

  describe("CAdES (CieSign)", () => {
    it("accepts an attached signature over the exact statement", async () => {
      const r = await verifyCieCades(pki.signCades(statement), statement, ctx);
      assert.equal(r.taxCode, FAKE_TAX_CODE);
      assert.ok(r.notAfter > new Date());
      assert.match(r.certRef.serialHex, /^[0-9a-f]+$/);
      assert.equal(r.certRef.ocspUrl, "http://ocsp.fake-cie.invalid/");
      assert.match(r.certRef.issuerSha256, /^[0-9a-f]{64}$/);
    });

    it("accepts a detached signature and base64/PEM input", async () => {
      await verifyCieCades(pki.signCades(statement, { detached: true }), statement, ctx);
      await verifyCieCades(Buffer.from(pki.signCades(statement).toString("base64")), statement, ctx);
    });

    it("accepts a CMS without embedded chain when the sub CA is in the trust store", async () => {
      await verifyCieCades(pki.signCades(statement, { embedChain: false }), statement, ctx);
    });

    it("rejects a signature over different content", async () => {
      const other = Buffer.from(statement.toString() + "x");
      await rejectsWith(verifyCieCades(pki.signCades(other), statement, ctx), "CONTENT_MISMATCH");
      await rejectsWith(verifyCieCades(pki.signCades(other, { detached: true }), statement, ctx), "SIGNATURE_INVALID");
    });

    it("rejects garbage", async () => {
      await rejectsWith(verifyCieCades(Buffer.from("not a cms"), statement, ctx), "CMS_INVALID");
    });
  });

  describe("raw signature (Android app)", () => {
    it("accepts PKCS#1 v1.5 SHA-256 over the statement", async () => {
      const sig = sign("sha256", statement, pki.holderKeyPem);
      const r = await verifyCieRaw(pki.holderPem, sig, statement, ctx);
      assert.equal(r.taxCode, FAKE_TAX_CODE);
    });

    it("rejects a signature over another statement", async () => {
      const sig = sign("sha256", Buffer.from("other"), pki.holderKeyPem);
      await rejectsWith(verifyCieRaw(pki.holderPem, sig, statement, ctx), "SIGNATURE_INVALID");
    });
  });

  describe("trust and certificate checks", () => {
    it("rejects a chain to an unpinned root", async () => {
      const certs = [parseCertificate(pki.rootPem), parseCertificate(pki.subPem)];
      const unpinned = { ...ctx, trust: trustStoreFromCerts(certs, ["00".repeat(32)]) };
      await rejectsWith(verifyCieCades(pki.signCades(statement), statement, unpinned), "CHAIN_UNTRUSTED");
    });

    it("rejects a holder from a different PKI even if it embeds its own chain", async () => {
      const other = createFakePki();
      try {
        await rejectsWith(verifyCieCades(other.signCades(statement), statement, ctx), "CHAIN_UNTRUSTED");
      } finally {
        other.cleanup();
      }
    });

    it("rejects an expired certificate", async () => {
      const later = { ...ctx, now: new Date(Date.now() + 40 * 86400_000) };
      await rejectsWith(verifyCieCades(pki.signCades(statement), statement, later), "CERT_EXPIRED");
    });

    it("rejects a certificate without the CIE policy", async () => {
      const other = createFakePki({ policy: "1.2.3.4" });
      try {
        const certs = [parseCertificate(other.rootPem), parseCertificate(other.subPem)];
        const c = { trust: trustStoreFromCerts(certs, [other.rootSha256]), ocspTransport: other.ocspTransport };
        await rejectsWith(verifyCieCades(other.signCades(statement), statement, c), "CERT_POLICY");
      } finally {
        other.cleanup();
      }
    });

    it("rejects a commonName without a tax code", async () => {
      const other = createFakePki({ cn: "NOT A TAX CODE" });
      try {
        const certs = [parseCertificate(other.rootPem), parseCertificate(other.subPem)];
        const c = { trust: trustStoreFromCerts(certs, [other.rootSha256]), ocspTransport: other.ocspTransport };
        await rejectsWith(verifyCieCades(other.signCades(statement), statement, c), "TAX_CODE_NOT_FOUND");
      } finally {
        other.cleanup();
      }
    });
  });

  describe("revocation (OCSP, fail-closed)", () => {
    it("rejects a revoked certificate", async () => {
      pki.setStatus("revoked");
      try {
        await rejectsWith(verifyCieCades(pki.signCades(statement), statement, ctx), "CERT_REVOKED");
      } finally {
        pki.setStatus("good");
      }
    });

    it("rejects when the responder is unreachable", async () => {
      const down = { ...ctx, ocspTransport: async () => { throw new Error("ECONNREFUSED"); } };
      await rejectsWith(verifyCieCades(pki.signCades(statement), statement, down), "OCSP_UNAVAILABLE");
    });

    it("rejects a response not signed by the issuer side", async () => {
      const other = createFakePki();
      try {
        const forged = { ...ctx, ocspTransport: other.ocspTransport };
        await assert.rejects(verifyCieCades(pki.signCades(statement), statement, forged), (e) =>
          ["OCSP_INVALID"].includes(e.code));
      } finally {
        other.cleanup();
      }
    });

    it("rechecks by stored reference (serial + issuer + URL) without the holder certificate", async () => {
      const r = await verifyCieCades(pki.signCades(statement), statement, ctx);
      const issuer = parseCertificate(pki.subPem);
      const args = { issuer, serialHex: r.certRef.serialHex, url: r.certRef.ocspUrl, transport: pki.ocspTransport };
      assert.equal(await ocspStatus(args), "good");
      pki.setStatus("revoked");
      try {
        assert.equal(await ocspStatus(args), "revoked");
      } finally {
        pki.setStatus("good");
      }
    });
  });

  describe("UCL-18: PKI hardening", () => {
    it("refuses a CMS signature with SHA-1", async () => {
      await assert.rejects(verifyCieCades(pki.signCades(statement, { md: "sha1" }), statement, ctx), (e) => e.code === "CMS_INVALID");
    });

    it("refuses a replayed OCSP response (nonce of another request)", async () => {
      const r = await verifyCieCades(pki.signCades(statement), statement, ctx);
      const issuer = parseCertificate(pki.subPem);
      let first = null;
      const replay = async (url, req) => (first ??= await pki.ocspTransport(url, req));
      const args = { issuer, serialHex: r.certRef.serialHex, url: r.certRef.ocspUrl, transport: replay };
      assert.equal(await ocspStatus(args), "good"); // first answer: its own nonce
      await assert.rejects(ocspStatus(args), (e) => e.code === "OCSP_INVALID"); // same answer again: nonce mismatch
    });
  });

  describe("trust store from files", () => {
    it("loads only pinned roots and CA intermediates", () => {
      const dir = mkdtempSync(path.join(tmpdir(), "trust-"));
      try {
        writeFileSync(path.join(dir, "root.pem"), pki.rootPem);
        writeFileSync(path.join(dir, "sub.pem"), pki.subPem);
        writeFileSync(path.join(dir, "holder.pem"), pki.holderPem); // must be ignored (not a CA)
        const store = loadTrustStore(dir, [pki.rootSha256]);
        assert.equal(store.roots.length, 1);
        assert.equal(store.intermediates.length, 1);
        assert.throws(() => loadTrustStore(dir, ["11".repeat(32)]), (e) => e.code === "TRUST_CONFIG");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
