// Extracts the CA certificates (root and sub CA, NOT the holder certificate) embedded in a CIE .p7m
// signed with CieSign, writes them as PEM into the trust store and prints their SHA-256 fingerprints.
// CA certificates are public; the holder certificate (personal data) is skipped and never written.
//
//   node scripts/trust-extract.js <file.p7m> [trust-dir]
//
// Then pin the root fingerprint in CIE_ROOT_SHA256 (backend .env) after checking it against an independent
// source (e.g. the AgID Trusted List or the Ministero dell'Interno website).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { certSha256, certToPem, decodeBinary, dnString, isCa, isSelfIssued, parseAsn1, pkijs } from "../src/cie/pki.js";

const [file, dir = "trust"] = process.argv.slice(2);
if (!file) {
  console.error("Usage: node scripts/trust-extract.js <file.p7m> [trust-dir]");
  process.exit(2);
}

const contentInfo = new pkijs.ContentInfo({ schema: parseAsn1(decodeBinary(readFileSync(file))) });
const signedData = new pkijs.SignedData({ schema: contentInfo.content });
const cas = (signedData.certificates ?? []).filter((c) => c instanceof pkijs.Certificate && isCa(c));
if (cas.length === 0) {
  console.error("No CA certificates embedded in this file");
  process.exit(1);
}

mkdirSync(dir, { recursive: true });
for (const c of cas) {
  const fp = certSha256(c);
  const name = `${isSelfIssued(c) ? "root" : "subca"}-${fp.slice(0, 16)}.pem`;
  const out = path.join(dir, name);
  if (!existsSync(out)) writeFileSync(out, certToPem(c));
  console.log(`${isSelfIssued(c) ? "ROOT " : "SUBCA"} ${dnString(c.subject)}`);
  console.log(`      valid until ${c.notAfter.value.toISOString().slice(0, 10)}, SHA-256 ${fp}`);
  console.log(`      -> ${out}`);
}
console.log("\nHolder certificate skipped (personal data). Pin the ROOT fingerprint in CIE_ROOT_SHA256.");
