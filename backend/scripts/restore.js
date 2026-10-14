// Restores an encrypted backup made by backup.js into a NEW database file.
// Needs the age PRIVATE key (kept offline, never on the server in normal operation).
//
//   node scripts/restore.js --file <backup.db.gz.age> --identity <age-key.txt> --out <restored.db> [--force]
//
// Checks: SHA-256 against the .sha256 file, decryption, gunzip, SQLite integrity_check.
// It never overwrites an existing file unless --force is given; stop the service before replacing the live DB.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { Decrypter } from "age-encryption";

export async function restore({ file, identity, out, force = false }) {
  if (existsSync(out) && !force) throw new Error(`${out} exists: use --force to overwrite (stop the service first)`);
  const encrypted = readFileSync(file);
  const shaFile = `${file}.sha256`;
  if (existsSync(shaFile)) {
    const expected = readFileSync(shaFile, "utf8").split(/\s+/)[0];
    const actual = createHash("sha256").update(encrypted).digest("hex");
    if (expected !== actual) throw new Error("SHA-256 mismatch: the backup file is corrupted or altered");
  }
  const key = readFileSync(identity, "utf8").split("\n").map((l) => l.trim()).find((l) => l.startsWith("AGE-SECRET-KEY-"));
  if (!key) throw new Error("no AGE-SECRET-KEY found in the identity file");
  const dec = new Decrypter();
  dec.addIdentity(key);
  const plain = gunzipSync(Buffer.from(await dec.decrypt(encrypted)));

  const tmp = path.join(path.dirname(path.resolve(out)), `.${path.basename(out)}.restoring`);
  writeFileSync(tmp, plain, { mode: 0o600 });
  try {
    const db = new Database(tmp);
    db.pragma("journal_mode = DELETE");
    const integrity = db.pragma("integrity_check", { simple: true });
    const version = db.pragma("user_version", { simple: true });
    db.close();
    if (integrity !== "ok") throw new Error(`integrity check failed: ${integrity}`);
    renameSync(tmp, out);
    return { out, bytes: plain.length, schemaVersion: version };
  } finally {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`, `${tmp}-journal`]) rmSync(f, { force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: { file: { type: "string" }, identity: { type: "string" }, out: { type: "string" }, force: { type: "boolean", default: false } },
  });
  if (!values.file || !values.identity || !values.out) {
    console.error("Usage: node scripts/restore.js --file <backup> --identity <age-key.txt> --out <restored.db> [--force]");
    process.exit(2);
  }
  try {
    const r = await restore(values);
    console.log(`restore ok: ${r.out} (${r.bytes} bytes, schema v${r.schemaVersion})`);
  } catch (e) {
    console.error(`restore FAILED: ${e.message}`);
    process.exit(1);
  }
}
