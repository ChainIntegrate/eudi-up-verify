// UCL-44: a data request signed with the CIE, for a person with no valid UP left (operator's script).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { getAddress } from "ethers";
import { parseCertificate } from "../src/cie/pki.js";
import { trustStoreFromCerts } from "../src/cie/trust.js";
import { openDb } from "../src/db.js";
import { applyLink } from "../src/linking.js";
import { requestText, verifyCieRequest } from "../src/subjectCie.js";
import { FAKE_TAX_CODE, createFakePki } from "./helpers/fake-pki.js";
import { testSigner } from "./helpers/signer.js";

const UP = getAddress("0x83cbe526d949a3aaab4ef9a03e48dd862e81472c");

describe("UCL-44: CIE-signed data requests", () => {
  let pki, trust, other, db, signer;
  before(async () => {
    pki = createFakePki();
    trust = trustStoreFromCerts([parseCertificate(pki.rootPem), parseCertificate(pki.subPem)], [pki.rootSha256]);
    other = pki.issueHolder("VRDLGU75C41F205X");
    ({ signer } = testSigner());
    db = openDb(":memory:");
    // the UP's link has ended (renounced): only the CIE can prove the person now
    applyLink(db, { up: UP, personKey: await signer.personKey(FAKE_TAX_CODE), primary: true, expiresAtMs: Date.now() + 1e10, certRefEnc: null, txHash: "0x01" });
    db.prepare("UPDATE links SET status = 'invalidated' WHERE up = ?").run(UP);
  });
  after(() => pki.cleanup());
  const ctx = (extra = {}) => ({ db, signer, trust, up: UP, ocspTransport: pki.ocspTransport, ...extra });
  const signed = (text, holder) => pki.signCades(Buffer.from(text, "ascii"), holder ? { holder } : {});

  it("accepts the request when the card's holder is the person of the UP", async () => {
    assert.deepEqual(await verifyCieRequest(signed(requestText(UP, "erase")), ctx()), { action: "erase" });
    assert.match(requestText(UP, "export"), /^up-cie-link data request by CIE v1\nUniversal-Profile: 0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C\nRequest: export\nDate: \d{4}-\d{2}-\d{2}\n/);
  });

  it("refuses another person's card, another UP, an old or altered text", async () => {
    await assert.rejects(verifyCieRequest(signed(requestText(UP, "erase"), other), ctx()), (e) => e.code === "NOT_THE_SAME_PERSON");
    await assert.rejects(verifyCieRequest(signed(requestText("0x1111111111111111111111111111111111111111", "erase")), ctx()), (e) => e.code === "WRONG_UP");
    await assert.rejects(verifyCieRequest(signed(requestText(UP, "erase", new Date(Date.now() - 40 * 86_400_000))), ctx()), (e) => e.code === "TOO_OLD");
    await assert.rejects(verifyCieRequest(signed(`${requestText(UP, "erase")} please`), ctx()), (e) => e.code === "BAD_TEXT");
    await assert.rejects(verifyCieRequest(signed("hello"), ctx()), (e) => e.code === "BAD_TEXT");
  });
});
