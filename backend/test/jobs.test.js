import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { parseCertificate } from "../src/cie/pki.js";
import { trustStoreFromCerts } from "../src/cie/trust.js";
import { verifyCieCades } from "../src/cie/verify.js";
import { kvGet, openDb } from "../src/db.js";
import { applyLink } from "../src/linking.js";
import { flushNotifications, notify } from "../src/notify.js";
import { createSerialQueue } from "../src/queue.js";
import { runCleanup, runRevocationCheck } from "../src/revocation.js";
import { encryptCertRef } from "../src/secrets.js";
import { backup, rotationKeep } from "../scripts/backup.js";
import { restore } from "../scripts/restore.js";
import { createFakePki } from "./helpers/fake-pki.js";

const UP = "0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C";
const DAY = 86_400_000;

describe("notifications outbox", () => {
  it("sends pending messages once, retries on failure, keeps them without a mailer", async () => {
    const db = openDb(":memory:");
    notify(db, { kind: "k", severity: "problem", subject: "s1", body: "b1" });
    notify(db, { kind: "k", severity: "event", subject: "s2", body: "b2" });
    assert.equal(await flushNotifications(db, null), 0);

    const sent = [];
    let fail = true;
    const mailer = { send: async (subject) => { if (fail) throw new Error("smtp"); sent.push(subject); } };
    assert.equal(await flushNotifications(db, mailer), 0);
    assert.equal(db.prepare("SELECT attempts FROM notifications WHERE id = 1").get().attempts, 1);
    fail = false;
    assert.equal(await flushNotifications(db, mailer), 2);
    assert.equal(await flushNotifications(db, mailer), 0);
    assert.deepEqual(sent, ["[PROBLEM] up-cie-link: s1", "[EVENT] up-cie-link: s2"]);
  });
});

describe("revocation recheck and cleanup", () => {
  let pki, trust;
  const certRefKey = randomBytes(32);
  before(() => {
    pki = createFakePki();
    trust = trustStoreFromCerts([parseCertificate(pki.rootPem), parseCertificate(pki.subPem)], [pki.rootSha256]);
  });
  after(() => pki.cleanup());

  async function dbWithLink() {
    const db = openDb(":memory:");
    const text = Buffer.from("statement");
    const r = await verifyCieCades(pki.signCades(text), text, { trust, ocspTransport: pki.ocspTransport });
    applyLink(db, {
      up: UP,
      personKey: randomBytes(32),
      primary: true,
      expiresAtMs: Date.now() + 10 * DAY,
      certRefEnc: encryptCertRef(certRefKey, r.certRef),
      txHash: "0x01",
    });
    return db;
  }
  const minterSpy = () => ({ calls: [], async invalidate(up, reason) { this.calls.push([up, reason]); return "0xabc"; } });

  it("good certificate: nothing happens", async () => {
    const db = await dbWithLink();
    const minter = minterSpy();
    const r = await runRevocationCheck({ db, trust, certRefKey, queue: createSerialQueue(), minter, transport: pki.ocspTransport });
    assert.deepEqual(r, { checked: 1, good: 1, revoked: 0, unavailable: 0, errors: 0 });
    assert.equal(minter.calls.length, 0);
    assert.equal(db.prepare("SELECT last_ocsp_status s FROM links").get().s, "good");
  });

  it("revoked certificate: invalidates on-chain and notifies", async () => {
    const db = await dbWithLink();
    const minter = minterSpy();
    pki.setStatus("revoked");
    try {
      const r = await runRevocationCheck({ db, trust, certRefKey, queue: createSerialQueue(), minter, transport: pki.ocspTransport });
      assert.equal(r.revoked, 1);
    } finally {
      pki.setStatus("good");
    }
    assert.deepEqual(minter.calls, [[UP, "INVALIDATED"]]); // UCL-03: generic reason on-chain
    assert.equal(db.prepare("SELECT status, cert_ref_enc FROM links").get().status, "invalidated");
    assert.equal(db.prepare("SELECT cert_ref_enc c FROM links").get().c, null); // UCL-10
    assert.equal(db.prepare("SELECT kind FROM notifications").get().kind, "invalidated_cert_revoked");
    assert.equal(db.prepare("SELECT detail FROM audit WHERE event = 'invalidated'").get().detail, "CERT_REVOKED");
  });

  it("OCSP unreachable: never invalidates; one problem after 3 consecutive days", async () => {
    const db = await dbWithLink();
    const minter = minterSpy();
    const down = async () => { throw new Error("down"); };
    let t = Date.now();
    for (let d = 0; d < 5; d++, t += DAY) {
      await runRevocationCheck({ db, trust, certRefKey, queue: createSerialQueue(), minter, transport: down, now: () => t });
    }
    assert.equal(minter.calls.length, 0);
    assert.equal(db.prepare("SELECT status FROM links").get().status, "valid");
    const problems = db.prepare("SELECT * FROM notifications WHERE kind = 'ocsp_unavailable'").all();
    assert.equal(problems.length, 1);
    assert.equal(kvGet(db, "ocsp_unavailable").days, 5);
    // back online resets the streak
    await runRevocationCheck({ db, trust, certRefKey, queue: createSerialQueue(), minter, transport: pki.ocspTransport, now: () => t });
    assert.equal(kvGet(db, "ocsp_unavailable").days, 0);
  });

  it("cleanup removes old statements and abandons stale exception requests", () => {
    const db = openDb(":memory:");
    const now = Date.now();
    db.prepare("INSERT INTO statements (id, up, mode, nonce, text_sha256, issued_at, expires_at, status) VALUES ('a', ?, 'link', 'n1', 'h', ?, ?, 'expired')")
      .run(UP, now - 10 * DAY, now - 9 * DAY);
    db.prepare("INSERT INTO statements (id, up, mode, nonce, text_sha256, issued_at, expires_at, status) VALUES ('b', ?, 'link', 'n2', 'h', ?, ?, 'pending_up')")
      .run(UP, now, now + DAY);
    db.prepare("INSERT INTO persons (person_key, created_at) VALUES (?, ?)").run(Buffer.alloc(32, 1), now);
    db.prepare("INSERT INTO exception_requests VALUES ('0xt', ?, 'pending', ?)").run(Buffer.alloc(32, 1), now - 40 * DAY);
    assert.deepEqual(runCleanup(db, now), { statements: 1, exceptions: 1, notifications: 0, certRefs: 0, links: 0, orphanRequests: 0, persons: 0, auditRows: 0 });
    assert.equal(db.prepare("SELECT status FROM exception_requests").get().status, "abandoned");
  });
});

describe("UCL-10: retention and data-subject requests", () => {
  const now = Date.parse("2026-10-15T10:00:00Z");
  const YEAR = 365 * DAY;
  const UP2 = "0x4a2605796e0d91A9667d6E30365aEEC384C48c27";

  function linked(db, up, personKey, fields = {}) {
    applyLink(db, { up, personKey, primary: true, expiresAtMs: now + YEAR, certRefEnc: Buffer.from("ref"), txHash: "0x01" }, now - 2 * YEAR);
    const sets = Object.keys(fields).map((k) => `${k} = @${k}`).join(", ");
    if (sets) db.prepare(`UPDATE links SET ${sets} WHERE up = @up`).run({ up, ...fields });
  }

  it("deletes certificate references at expiry and links, person keys and audit after 12 months", () => {
    const db = openDb(":memory:");
    const alice = randomBytes(32);
    const bob = randomBytes(32);
    linked(db, UP, alice, { expires_at: now - DAY }); // expired yesterday: keep the link, drop the cert ref
    linked(db, UP2, bob, { status: "invalidated", updated_at: now - YEAR - DAY }); // ended over a year ago
    db.prepare("INSERT INTO audit (ts, event, up) VALUES (?, 'old', ?)").run(now - YEAR - DAY, UP);
    const r = runCleanup(db, now);
    assert.equal(r.certRefs, 1);
    assert.equal(r.links, 1);
    assert.equal(r.persons, 1);
    assert.equal(r.auditRows, 1);
    assert.equal(db.prepare("SELECT cert_ref_enc FROM links WHERE up = ?").get(UP).cert_ref_enc, null);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM links WHERE up = ?").get(UP2).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM persons WHERE person_key = ?").get(bob).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM persons WHERE person_key = ?").get(alice).n, 1);
  });

  it("export shows everything kept; erase removes it and queues the on-chain invalidation", async () => {
    const { eraseSubject, exportSubject } = await import("../src/subject.js");
    const db = openDb(":memory:");
    const person = randomBytes(32);
    linked(db, UP, person);
    applyLink(db, { up: UP2, personKey: person, primary: false, expiresAtMs: now + YEAR, certRefEnc: null, txHash: "0x02" }, now);
    db.prepare("INSERT INTO exception_requests VALUES ('0xt', ?, 'approved', ?)").run(person, now);
    db.prepare("INSERT INTO audit (ts, event, up) VALUES (?, 'attested', ?)").run(now, UP);
    notify(db, { kind: "k", severity: "event", subject: `badge for ${UP}`, body: "x" }, now);

    const data = exportSubject(db, UP2);
    assert.deepEqual(data.links.map((l) => l.up).sort(), [UP, UP2].sort());
    assert.equal(data.exceptionRequests[0].ticket, "0xt");
    assert.equal(exportSubject(db, "0x0000000000000000000000000000000000000001"), null);

    const r = eraseSubject(db, UP.toLowerCase(), now);
    assert.equal(r.invalidations, 2);
    for (const table of ["links", "persons", "exception_requests"]) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0, table);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE up IS NOT NULL").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 0);
    assert.deepEqual(db.prepare("SELECT reason FROM pending_invalidations").all().map((x) => x.reason), ["ERASED", "ERASED"]);
  });
});

describe("backup and restore", () => {
  let dir;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "backup-test-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("encrypted backup restores to an identical, consistent database", async () => {
    const dbPath = path.join(dir, "live.db");
    const db = openDb(dbPath);
    db.prepare("INSERT INTO persons (person_key, created_at) VALUES (?, ?)").run(randomBytes(32), Date.now());
    const identity = await generateX25519Identity();
    const recipient = await identityToRecipient(identity);
    const backupDir = path.join(dir, "backups");
    const s = await backup({ dbPath, backupDir, recipient });
    assert.ok(existsSync(path.join(backupDir, s.file)));
    assert.equal(JSON.parse(readFileSync(path.join(backupDir, "last-backup.json"), "utf8")).sha256, s.sha256);
    // the encrypted file does not contain the SQLite header in clear
    assert.ok(!readFileSync(path.join(backupDir, s.file)).includes(Buffer.from("SQLite format 3")));
    // no temporary plain copy left behind
    assert.deepEqual(readdirSync(backupDir).filter((n) => n.startsWith(".tmp")), []);

    const keyFile = path.join(dir, "age-key.txt");
    writeFileSync(keyFile, `# test key\n${identity}\n`);
    const out = path.join(dir, "restored.db");
    const r = await restore({ file: path.join(backupDir, s.file), identity: keyFile, out });
    assert.equal(r.schemaVersion, 5);
    const restored = new Database(out, { readonly: true });
    assert.equal(restored.prepare("SELECT COUNT(*) n FROM persons").get().n, 1);
    restored.close();
    await assert.rejects(restore({ file: path.join(backupDir, s.file), identity: keyFile, out }), /exists/);

    // interoperable with the standard age tool, when installed
    try {
      execFileSync("age", ["--version"]);
      const plain = execFileSync("age", ["-d", "-i", keyFile, path.join(backupDir, s.file)]);
      assert.equal(plain[0], 0x1f); // gzip magic
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    db.close();
  });

  it("detects a tampered backup", async () => {
    const dbPath = path.join(dir, "live2.db");
    openDb(dbPath).close();
    const identity = await generateX25519Identity();
    const backupDir = path.join(dir, "backups2");
    const s = await backup({ dbPath, backupDir, recipient: await identityToRecipient(identity) });
    const file = path.join(backupDir, s.file);
    const buf = readFileSync(file);
    buf[buf.length - 1] ^= 0xff;
    writeFileSync(file, buf);
    const keyFile = path.join(dir, "k2.txt");
    writeFileSync(keyFile, identity);
    await assert.rejects(restore({ file, identity: keyFile, out: path.join(dir, "r2.db") }), /SHA-256 mismatch/);
  });

  it("rotation keeps 14 recent backups and one per week for 8 more weeks", () => {
    const names = [];
    for (let d = 0; d < 120; d++) {
      const t = new Date(Date.UTC(2026, 9, 14) - d * DAY).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      names.push(`up-cie-link-${t}.db.gz.age`);
    }
    const keep = rotationKeep(names);
    assert.equal(keep.size, 22);
    const newest = [...names].sort().reverse().slice(0, 14);
    for (const n of newest) assert.ok(keep.has(n));
  });
});
