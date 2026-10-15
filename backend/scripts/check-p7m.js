// Checks a real CieSign .p7m against the configured trust store and the REAL Ministry OCSP (audit UCL-06):
// CMS signature, certificate checks, chain to the pinned root, OCSP response (signature, algorithm, nonce,
// freshness). The signed content is taken from the file itself, so any .p7m signed with the CIE works.
// It prints only outcomes: never the tax code, names or the certificate.
//
//   node scripts/check-p7m.js <file.p7m>        (TRUST_DIR and CIE_ROOT_SHA256 from backend/.env)
//
// The .p7m contains personal data: delete it from the server right after the check.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CieError, decodeBinary, parseAsn1, pkijs } from "../src/cie/pki.js";
import { loadTrustStore } from "../src/cie/trust.js";
import { verifyCieCades } from "../src/cie/verify.js";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export async function checkP7m(file, { trustDir, rootSha256, ocspTransport, now } = {}) {
  const der = decodeBinary(readFileSync(file));
  const signed = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: parseAsn1(der) }).content });
  const e = signed.encapContentInfo.eContent;
  if (!e) throw new CieError("CMS_INVALID", "detached signature: this check needs the content inside the .p7m");
  const content = e.idBlock.isConstructed
    ? Buffer.concat(e.valueBlock.value.map((b) => Buffer.from(b.valueBlock.valueHexView)))
    : Buffer.from(e.valueBlock.valueHexView);
  const trust = loadTrustStore(trustDir, rootSha256);
  const r = await verifyCieCades(der, content, { trust, ocspTransport, now });
  return {
    ok: true,
    taxCodeFound: typeof r.taxCode === "string" && r.taxCode.length === 16,
    certificateValidUntil: r.notAfter.toISOString().slice(0, 7), // month only
    ocspUrl: r.certRef.ocspUrl,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/check-p7m.js <file.p7m>");
    process.exit(2);
  }
  const trustDir = process.env.TRUST_DIR || fileURLToPath(new URL("../trust", import.meta.url));
  const roots = (process.env.CIE_ROOT_SHA256 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const r = await checkP7m(file, { trustDir, rootSha256: roots });
    console.log("CHECK OK: signature, certificate, chain to the pinned root and real OCSP answer are valid");
    console.log(`  tax code found in the certificate: ${r.taxCodeFound ? "yes (not shown)" : "NO"}`);
    console.log(`  certificate valid until (month):   ${r.certificateValidUntil}`);
    console.log(`  OCSP responder:                    ${r.ocspUrl}`);
  } catch (e) {
    const detail = e instanceof CieError && e.message !== e.code ? ` (${e.message})` : "";
    console.error(`CHECK FAILED: ${e instanceof CieError ? e.code : "ERROR"}${detail}`);
    if (e instanceof CieError && e.code === "OCSP_INVALID") {
      console.error("  If the detail mentions the signature, the responder may sign with SHA-1: see OCSP_ALLOW_SHA1 in .env.example.");
    }
    process.exit(1);
  }
}
