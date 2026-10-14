// Generates an age key pair for the backups. Run it on YOUR machine, not on the server:
//   node scripts/age-keygen.js > up-cie-link-backup-key.txt
// Keep the file (private key) offline; put only the printed public key (age1...) in BACKUP_AGE_RECIPIENT.
import { generateX25519Identity, identityToRecipient } from "age-encryption";

const identity = await generateX25519Identity();
const recipient = await identityToRecipient(identity);
console.log(`# up-cie-link backup key, created ${new Date().toISOString()}`);
console.log(`# public key: ${recipient}`);
console.log(identity);
console.error(`public key (BACKUP_AGE_RECIPIENT): ${recipient}`);
