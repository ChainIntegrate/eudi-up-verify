// Regression tests for the path validation flaw found on 2026-10-14: pkijs CertificateChainValidationEngine
// accepted a holder certificate NOT signed by the CA it was linked to (name match only).
// The two fake PKIs below use identical names, so only signatures tell them apart.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { validateChain } from "../src/cie/chain.js";
import { certSha256, parseCertificate } from "../src/cie/pki.js";
import { createFakePki } from "./helpers/fake-pki.js";

describe("certificate path validation", () => {
  let a, b, rootA, subA, leafA, rootB, subB, leafB;

  before(() => {
    a = createFakePki();
    b = createFakePki();
    [rootA, subA, leafA] = [a.rootPem, a.subPem, a.holderPem].map(parseCertificate);
    [rootB, subB, leafB] = [b.rootPem, b.subPem, b.holderPem].map(parseCertificate);
  });
  after(() => {
    a.cleanup();
    b.cleanup();
  });

  const untrusted = (fn) => assert.throws(fn, (e) => e.code === "CHAIN_UNTRUSTED");

  it("accepts leaf -> sub CA -> pinned root and returns the direct issuer", () => {
    const { issuer, path } = validateChain(leafA, [subA], [rootA]);
    assert.equal(certSha256(issuer), certSha256(subA));
    assert.equal(path.length, 3);
  });

  it("rejects a foreign leaf linked by name to our sub CA (the pkijs flaw)", () => {
    untrusted(() => validateChain(leafB, [subA], [rootA]));
  });

  it("rejects a foreign sub CA linked by name to our root", () => {
    untrusted(() => validateChain(leafB, [subB], [rootA]));
  });

  it("rejects a path ending on an unpinned root, even if provided as candidate", () => {
    untrusted(() => validateChain(leafB, [subB, rootB], [rootA]));
  });

  it("rejects when the intermediate is missing", () => {
    untrusted(() => validateChain(leafA, [], [rootA]));
  });

  it("rejects when the sub CA is not valid at the given date", () => {
    untrusted(() => validateChain(leafA, [subA], [rootA], new Date(Date.now() + 6 * 365 * 86400_000)));
  });
});
