// Server-side secrets: pseudonymous person key and encrypted certificate reference.
//  - personKey = HMAC-SHA256(UNIQ_PEPPER, tax code). The tax code itself is never stored.
//    Losing UNIQ_PEPPER makes every stored person key useless (uniqueness lost): keep it outside the DB and backups.
//  - certRef (serial, issuer fingerprint, OCSP URL) is stored AES-256-GCM encrypted with CERT_REF_KEY,
//    only to recheck revocation later (D5.2).
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export function parseKey(name, value, minBytes = 32) {
  if (typeof value !== "string" || !/^(0x)?[0-9a-fA-F]+$/.test(value)) throw new Error(`${name} must be hex`);
  const buf = Buffer.from(value.replace(/^0x/, ""), "hex");
  if (buf.length < minBytes) throw new Error(`${name} must be at least ${minBytes} bytes (${minBytes * 2} hex chars)`);
  return buf;
}

export function personKey(pepper, taxCode) {
  return createHmac("sha256", pepper).update(`up-cie-link:person:v1:${taxCode.toUpperCase()}`).digest();
}

const VERSION = 1;

export function encryptCertRef(key, certRef) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.subarray(0, 32), iv);
  const plain = Buffer.from(JSON.stringify(certRef), "utf8");
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), enc]);
}

export function decryptCertRef(key, blob) {
  if (blob[0] !== VERSION) throw new Error("unknown certRef version");
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const decipher = createDecipheriv("aes-256-gcm", key.subarray(0, 32), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString("utf8"));
}

/** Opaque exception ticket (bytes32), carries no personal data. */
export const newTicket = () => `0x${randomBytes(32).toString("hex")}`;
