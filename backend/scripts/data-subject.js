// Data-subject requests handled by the operator (UCL-10, UCL-44). People normally use the "My badge" page, signing
// with a UP whose link is valid. This script is for a person who has no valid UP left: they sign a text with the
// CIE (CieSign) and the request is executed only if the card's holder is the person linked to the UP.
//   node scripts/data-subject.js template export|erase --up 0x...          prints the text to sign (save as .txt)
//   node scripts/data-subject.js export --up 0x... --p7m <file>             checks the CIE request, prints the data (JSON)
//   node scripts/data-subject.js erase  --up 0x... --p7m <file> [--yes]     checks it, erases (without --yes: shows what)
// Run it on the server, as the service user (it asks the signer for the person key). The .p7m holds personal data:
// keep it in a private folder and delete it (shred -u) afterwards, as in docs/operations.md §2.4.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isAddress } from "ethers";
import { loadTrustStore } from "../src/cie/trust.js";
import { openDb } from "../src/db.js";
import { createSigner, socketTransport } from "../src/signer.js";
import { eraseSubject, exportSubject } from "../src/subject.js";
import { requestText, verifyCieRequest } from "../src/subjectCie.js";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { up: { type: "string" }, p7m: { type: "string" }, yes: { type: "boolean", default: false } },
});
const [command, templateAction] = positionals;
const usage = () => {
  console.error("Usage: node scripts/data-subject.js template export|erase --up 0x...");
  console.error("       node scripts/data-subject.js export|erase --up 0x... --p7m <file> [--yes]   (DB_PATH, TRUST_DIR, CIE_ROOT_SHA256 from backend/.env)");
  process.exit(2);
};
if (!values.up || !isAddress(values.up)) usage();

if (command === "template") {
  if (!["export", "erase"].includes(templateAction)) usage();
  process.stdout.write(requestText(values.up, templateAction));
  process.exit(0);
}
if (!["export", "erase"].includes(command) || !values.p7m || !process.env.DB_PATH) usage();

const db = openDb(process.env.DB_PATH);
try {
  const trustDir = process.env.TRUST_DIR || fileURLToPath(new URL("../trust", import.meta.url));
  const roots = (process.env.CIE_ROOT_SHA256 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const signer = createSigner(socketTransport(process.env.SIGNER_SOCKET || "/run/up-cie-link-signer/signer.sock"));
  const { action } = await verifyCieRequest(readFileSync(values.p7m), { db, signer, trust: loadTrustStore(trustDir, roots), up: values.up });
  if (action !== command) throw Object.assign(new Error(`the signed request is "${action}", not "${command}"`), { code: "WRONG_ACTION" });
  console.log("CIE request OK: the card's holder is the person linked to this UP.");
  const data = exportSubject(db, values.up);
  if (command === "export" || !values.yes) {
    console.log(JSON.stringify(data, null, 2));
    if (command === "erase") console.log(`\nThis would erase ${data.links.length} link(s) and invalidate the valid badges. Add --yes to proceed.`);
  } else {
    const r = eraseSubject(db, values.up);
    console.log(`Erased: ${r.ups.length} UP(s) (${r.ups.join(", ")}); ${r.invalidations} on-chain invalidation(s) queued.`);
    console.log("The backend invalidates them within a minute. The badge history on-chain cannot be erased.");
  }
} catch (e) {
  console.error(`data-subject: ${e.code ?? "ERROR"}${e.code ? "" : ` (${e.message})`}`);
  process.exitCode = 1;
} finally {
  db.close();
}
