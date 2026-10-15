import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { birthDate, isAtLeast } from "../src/cie/taxcode.js";
import { FAKE_TAX_CODE } from "./helpers/fake-pki.js";
import { checkChar } from "./helpers/taxcode.js";

describe("UCL-11: age from the tax code", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("reads the birth date (men, women, omocodia, century)", () => {
    assert.equal(birthDate("RSSMRA80A01H501X", now).toISOString().slice(0, 10), "1980-01-01");
    assert.equal(birthDate("VRDLGU75C41F205X", now).toISOString().slice(0, 10), "1975-03-01"); // woman: 41 = 1
    assert.equal(birthDate("BNCLRA08M50H501X", now).toISOString().slice(0, 10), "2008-08-10");
    assert.equal(birthDate("RSSMRAULALMH501X", now).toISOString().slice(0, 10), "1980-01-01"); // omocodia: U=8 L=0 M=1
    assert.equal(birthDate("RSSMRA30A01H501X", now).toISOString().slice(0, 10), "1930-01-01"); // 2030 is in the future
    assert.equal(birthDate("RSSMRA80Z01H501X", now), null); // no month Z
    assert.equal(birthDate("RSSMRA80B31H501X", now), null); // 31 February
  });

  it("18 years on the birthday, not before", () => {
    assert.equal(isAtLeast("BNCLRA08M50H501X", 18, new Date("2026-08-09T23:59:59Z")), false);
    assert.equal(isAtLeast("BNCLRA08M50H501X", 18, new Date("2026-08-10T00:00:00Z")), true);
    assert.equal(isAtLeast("BNCLRA15M50H501X", 18, now), false);
    assert.equal(isAtLeast("garbage", 18, now), false);
  });

  it("UCL-29: test tax codes have a wrong check character", () => {
    for (const cf of [FAKE_TAX_CODE, "VRDLGU75C41F205X", "BNCLRA08M50H501X"]) assert.notEqual(checkChar(cf.slice(0, 15)), cf[15], cf);
  });
});
