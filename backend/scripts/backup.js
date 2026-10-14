// Encrypted backup of the SQLite database (docs/02-backend.md §7).
//   1. consistent online copy (SQLite backup API) while the service runs
//   2. integrity check of the copy
//   3. gzip + age encryption to a PUBLIC key (the server can write backups but cannot read them)
//   4. SHA-256 next to the file, mode 600
//   5. rotation: the 14 most recent + the newest of each of the previous 8 ISO weeks
//   6. status file last-backup.json (read by the monitor); on failure a problem notification in the outbox
//
// Env: DB_PATH, BACKUP_DIR, BACKUP_AGE_RECIPIENT (age1...). Exit code 0 = ok, 1 = failure.
//   node scripts/backup.js
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { Encrypter } from "age-encryption";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const PREFIX = "up-cie-link-";
const SUFFIX = ".db.gz.age";

export function rotationKeep(names, { daily = 14, weekly = 8 } = {}) {
  const sorted = [...names].sort().reverse(); // timestamped names: newest first
  const keep = new Set(sorted.slice(0, daily));
  const weeks = new Map();
  for (const n of sorted.slice(daily)) {
    const m = n.match(/(\d{4})(\d{2})(\d{2})T/);
    if (!m) continue;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const week = isoWeek(d);
    if (!weeks.has(week) && weeks.size < weekly) weeks.set(week, n);
  }
  for (const n of weeks.values()) keep.add(n);
  return keep;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((t - yearStart) / 86400000 + 1) / 7)}`;
}

export async function backup({ dbPath, backupDir, recipient, now = new Date() }) {
  if (!dbPath || !backupDir || !recipient) throw new Error("DB_PATH, BACKUP_DIR and BACKUP_AGE_RECIPIENT are required");
  if (!recipient.startsWith("age1")) throw new Error("BACKUP_AGE_RECIPIENT must be an age public key (age1...)");
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  // temporary plain copy inside the backup directory (mode 700), removed in any case
  const tmp = path.join(backupDir, `.tmp-${process.pid}-${Date.now()}.db`);
  try {
    const src = new Database(dbPath, { readonly: true, fileMustExist: true });
    await src.backup(tmp);
    src.close();

    // the copy inherits WAL mode: switch it to a plain journal so no -wal/-shm files are created
    const copy = new Database(tmp);
    copy.pragma("journal_mode = DELETE");
    const integrity = copy.pragma("integrity_check", { simple: true });
    copy.close();
    if (integrity !== "ok") throw new Error(`integrity check failed: ${integrity}`);

    const enc = new Encrypter();
    enc.addRecipient(recipient);
    const encrypted = Buffer.from(await enc.encrypt(gzipSync(readFileSync(tmp))));

    const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const name = `${PREFIX}${stamp}${SUFFIX}`;
    const file = path.join(backupDir, name);
    const sha = createHash("sha256").update(encrypted).digest("hex");
    writeFileSync(file, encrypted, { mode: 0o600 });
    writeFileSync(`${file}.sha256`, `${sha}  ${name}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);

    const all = readdirSync(backupDir).filter((n) => n.startsWith(PREFIX) && n.endsWith(SUFFIX));
    const keep = rotationKeep(all);
    const removed = [];
    for (const n of all) {
      if (keep.has(n)) continue;
      rmSync(path.join(backupDir, n), { force: true });
      rmSync(path.join(backupDir, `${n}.sha256`), { force: true });
      removed.push(n);
    }
    const status = { at: now.toISOString(), file: name, sha256: sha, bytes: encrypted.length, kept: keep.size, removed: removed.length };
    writeFileSync(path.join(backupDir, "last-backup.json"), JSON.stringify(status, null, 2) + "\n", { mode: 0o600 });
    return status;
  } finally {
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`, `${tmp}-journal`]) rmSync(f, { force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { DB_PATH, BACKUP_DIR, BACKUP_AGE_RECIPIENT } = process.env;
  try {
    const s = await backup({ dbPath: DB_PATH, backupDir: BACKUP_DIR, recipient: BACKUP_AGE_RECIPIENT });
    console.log(`backup ok: ${s.file} (${s.bytes} bytes, sha256 ${s.sha256}); kept ${s.kept}, removed ${s.removed}`);
  } catch (e) {
    console.error(`backup FAILED: ${e.message}`);
    try {
      const db = new Database(DB_PATH);
      db.prepare("INSERT INTO notifications (ts, kind, severity, subject, body) VALUES (?, 'backup_failed', 'problem', ?, ?)").run(
        Date.now(),
        "database backup failed",
        `The daily encrypted backup failed: ${e.message}`,
      );
      db.close();
    } catch {
      /* the monitor will also report a missing/old backup */
    }
    process.exit(1);
  }
}
