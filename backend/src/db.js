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
  // v3: notification outbox (sent by the backend's mailer loop) and small key/value state
  `
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('problem','event','info')),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER
  );
  CREATE INDEX notifications_unsent ON notifications(sent_at);
  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // v4: last chain block applied to a link by the indexer (older events are ignored)
  `ALTER TABLE links ADD COLUMN last_event_block INTEGER;`,
  // v5 (UCL-04, UCL-20, UCL-07):
  //  - mints: a mint in flight, written BEFORE the transaction is sent, so a restart never loses the person key;
  //  - pending_invalidations: invalidations to send (migration, revoked certificate, erasure), retried until done;
  //  - persons.last_migration_at: at most one migration per period.
  `
  CREATE TABLE mints (
    statement_id TEXT PRIMARY KEY,
    up TEXT NOT NULL,
    person_key BLOB NOT NULL,
    is_primary INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    cert_ref_enc BLOB,
    replaces_up TEXT,
    ticket TEXT,
    tx_hash TEXT,
    created_at INTEGER NOT NULL,
    alerted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX mints_person ON mints(person_key);
  CREATE TABLE pending_invalidations (
    up TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  ALTER TABLE persons ADD COLUMN last_migration_at INTEGER;
  `,
  // UCL-41: the 30-day cool-down after a rejection counts from the rejection, not from the request
  `ALTER TABLE exception_requests ADD COLUMN rejected_at INTEGER;`,
];

export const kvGet = (db, key, fallback = null) => {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
};
export const kvSet = (db, key, value) =>
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));

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
