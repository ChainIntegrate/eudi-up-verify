// Data-subject requests (GDPR access / erasure), by UP address (UCL-10).
//   node scripts/data-subject.js export --up 0x...          prints everything kept about that person (JSON)
//   node scripts/data-subject.js erase  --up 0x... [--yes]  erases it; valid badges are invalidated on-chain by the
//                                                           running backend within a minute (it must be running)
// Run it on the server, as the service user. Without --yes, erase only shows what would be deleted.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isAddress } from "ethers";
import { openDb } from "../src/db.js";
import { eraseSubject, exportSubject } from "../src/subject.js";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { values, positionals } = parseArgs({ allowPositionals: true, options: { up: { type: "string" }, yes: { type: "boolean", default: false } } });
const [command] = positionals;
if (!["export", "erase"].includes(command) || !values.up || !isAddress(values.up) || !process.env.DB_PATH) {
  console.error("Usage: node scripts/data-subject.js export|erase --up 0x... [--yes]   (DB_PATH from backend/.env)");
  process.exit(2);
}
const db = openDb(process.env.DB_PATH);
try {
  const data = exportSubject(db, values.up);
  if (!data) {
    console.log("No data linked to this UP.");
    process.exit(0);
  }
  if (command === "export" || !values.yes) {
    console.log(JSON.stringify(data, null, 2));
    if (command === "erase") console.log(`\nThis would erase ${data.links.length} link(s) and invalidate the valid badges. Add --yes to proceed.`);
  } else {
    const r = eraseSubject(db, values.up);
    console.log(`Erased: ${r.ups.length} UP(s) (${r.ups.join(", ")}); ${r.invalidations} on-chain invalidation(s) queued.`);
    console.log("The backend invalidates them within a minute. The badge history on-chain cannot be erased.");
  }
} catch (e) {
  console.error(`data-subject: ${e.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
