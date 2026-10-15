// Generates an age key pair for the backups. Run it on YOUR machine, not on the server:
//   node scripts/age-keygen.js --out up-cie-link-backup-key.txt
// The file (private key) stays offline; only the printed public key (age1...) goes in BACKUP_AGE_RECIPIENT.
// The file is written by the script in UTF-8 (a PowerShell ">" redirect could write UTF-16).
import { existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { generateX25519Identity, identityToRecipient } from "age-encryption";

const { values } = parseArgs({ options: { out: { type: "string" } } });
const identity = await generateX25519Identity();
const recipient = await identityToRecipient(identity);
const text = `# up-cie-link backup key, created ${new Date().toISOString()}\n# public key: ${recipient}\n${identity}\n`;
if (values.out) {
  if (existsSync(values.out)) {
    console.error(`${values.out} already exists: choose another name (never overwrite a backup key)`);
    process.exit(1);
  }
  writeFileSync(values.out, text, { encoding: "utf8", mode: 0o600 });
  console.log(`private key written to ${values.out}: keep it offline (password manager / safe storage)`);
} else {
  process.stdout.write(text);
}
console.error(`public key (BACKUP_AGE_RECIPIENT): ${recipient}`);
