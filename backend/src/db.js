// SQLite storage (better-sqlite3). Schema from docs/02-backend.md §5.
// No personal data: persons are identified only by HMAC(UNIQ_PEPPER, tax code); certificate references are encrypted.
import Database from "better-sqlite3";

const MIGRATIONS = [
  // v1
  `
  CREATE TABLE statements (
    id TEXT PRIMARY KEY,
    up TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('link','migrate','additional')),
    nonce TEXT NOT NULL UNIQUE,
    text_sha256 TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    up_signed_at INTEGER,
    status TEXT NOT NULL,
    error_code TEXT,
    tx_hash TEXT
  );
  CREATE INDEX statements_expires ON statements(expires_at);
  CREATE TABLE persons (
    person_key BLOB PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE links (
    up TEXT PRIMARY KEY,
    person_key BLOB NOT NULL REFERENCES persons(person_key),
    is_primary INTEGER NOT NULL,
    status TEXT NOT NULL,
    verified_at INTEGER,
    expires_at INTEGER,
    cert_ref_enc BLOB,
    last_ocsp_at INTEGER,
    last_ocsp_status TEXT,
    tx_hash TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX links_person ON links(person_key);
  CREATE TABLE exception_requests (
    ticket TEXT PRIMARY KEY,
    person_key BLOB NOT NULL REFERENCES persons(person_key),
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE chain_cursor (
    name TEXT PRIMARY KEY,
    last_block INTEGER NOT NULL
  );
  CREATE TABLE audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    event TEXT NOT NULL,
    up TEXT,
    tx_hash TEXT,
    detail TEXT
  );
  `,
  // v2: exception ticket shown to the user when a statement needs an approved exception
  `ALTER TABLE statements ADD COLUMN exception_ticket TEXT;`,
];

export function openDb(path) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const version = db.pragma("user_version", { simple: true });
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

/** Audit entries: event codes, UP addresses and tx hashes only. Never personal data. */
export function audit(db, event, { up = null, txHash = null, detail = null } = {}, now = Date.now()) {
  db.prepare("INSERT INTO audit (ts, event, up, tx_hash, detail) VALUES (?, ?, ?, ?, ?)").run(now, event, up, txHash, detail);
}
