// Integration on a local Hardhat node with the real UpCieBadge and real LSP0 UPs:
//  - indexer: holder renounce(), owner revoke()/reinstate(), a mint not recorded locally, stale events
//  - monitor: findings, email on change only, reminder after 24 h, all clear, daily summary
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Contract, ContractFactory, Interface, NonceManager, Wallet, parseEther } from "ethers";
import { createMinter } from "../src/chain.js";
import { testSigner } from "./helpers/signer.js";
import { openDb } from "../src/db.js";
import { runIndexer } from "../src/indexer.js";
import { startMint } from "../src/mints.js";
import { applyLink } from "../src/linking.js";
import { runMonitor } from "../src/monitor.js";
import { artifact, contractsAvailable, startNode } from "./helpers/hardhat-node.js";

const HOUR = 3_600_000;

describe("indexer and monitor on a real chain", { skip: !contractsAvailable && "contracts not built" }, () => {
  let node, deployer, attesterKey, badgeAddress, deployBlock, ownerUp, ownerCtl, holderCtl, up1, up2, up3, upArt, badgeArt, dir;

  before(async () => {
    node = await startNode({ chainId: 4201 });
    [deployer] = node.wallets;
    attesterKey = node.keys[1];
    ownerCtl = new NonceManager(new Wallet(node.keys[2], node.provider));
    holderCtl = new NonceManager(new Wallet(node.keys[3], node.provider));
    upArt = artifact("universalProfile");
    badgeArt = artifact("badge");
    const deployUp = async (ctl) => {
      const c = await new ContractFactory(upArt.abi, upArt.bytecode, deployer).deploy(await ctl.getAddress());
      await c.waitForDeployment();
      return c.getAddress();
    };
    ownerUp = await deployUp(ownerCtl);
    up1 = await deployUp(holderCtl);
    up2 = await deployUp(holderCtl);
    up3 = await deployUp(holderCtl);
    const badge = await new ContractFactory(badgeArt.abi, badgeArt.bytecode, deployer).deploy(ownerUp, new Wallet(attesterKey).address);
    await badge.waitForDeployment();
    badgeAddress = await badge.getAddress();
    deployBlock = (await badge.deploymentTransaction().wait()).blockNumber;
    dir = mkdtempSync(path.join(tmpdir(), "idx-mon-"));
  });
  after(() => {
    node?.stop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** Calls a badge function through a UP (execute by its controller). */
  async function viaUp(upAddress, controller, fn, args) {
    const upC = new Contract(upAddress, upArt.abi, controller);
    const data = new Interface(badgeArt.abi).encodeFunctionData(fn, args);
    await (await upC.execute(0, badgeAddress, 0, data)).wait();
  }
  const mine = (n) => node.provider.send("hardhat_mine", [`0x${n.toString(16)}`]);

  it("indexer: renounce, unrecorded mint, revoke and reinstate", async () => {
    const db = openDb(":memory:");
    const { signer, address } = testSigner({ attesterKey, contract: badgeAddress, chainId: Number((await node.provider.getNetwork()).chainId) });
    const minter = createMinter(node.provider, badgeAddress, signer, () => address);
    const expires = Math.floor(Date.now() / 1000) + 365 * 86400;
    const tx1 = await minter.attest(up1, expires, true);
    applyLink(db, { up: up1, personKey: randomBytes(32), primary: true, expiresAtMs: expires * 1000, certRefEnc: Buffer.from("ref"), txHash: tx1 });
    await minter.attest(up2, expires, true); // minted but never recorded locally
    // UCL-39: minted after a timeout, with the mint still open: reconcileMints() closes it, no alert
    startMint(db, { statementId: "s3", up: up3, personKey: randomBytes(32), primary: true, expiresAt: expires * 1000 }, Date.now());
    await minter.attest(up3, expires, true);

    await viaUp(up1, holderCtl, "renounce", []);
    await mine(3);
    const r1 = await runIndexer({ db, provider: node.provider, address: badgeAddress, deployBlock, maxRange: 2 });
    assert.ok(r1.events >= 3);
    assert.deepEqual({ ...db.prepare("SELECT status, cert_ref_enc FROM links WHERE up = ?").get(up1) }, { status: "invalidated", cert_ref_enc: null }); // UCL-35
    const kinds = db.prepare("SELECT kind, severity FROM notifications ORDER BY id").all();
    assert.deepEqual(kinds.map((k) => k.kind).sort(), ["attested_unrecorded", "renounced"]);
    assert.equal(kinds.find((k) => k.kind === "attested_unrecorded").severity, "problem");

    // owner revokes up1, then reinstates it (UCL-35: the certificate reference is dropped on revocation too)
    db.prepare("UPDATE links SET cert_ref_enc = ? WHERE up = ?").run(Buffer.from("ref"), up1);
    const ownerData = (fn, args) => viaUp(ownerUp, ownerCtl, fn, args);
    await ownerData("revoke", [up1, "0x" + Buffer.from("ABUSE").toString("hex").padEnd(64, "0")]);
    await mine(3);
    await runIndexer({ db, provider: node.provider, address: badgeAddress, deployBlock });
    assert.deepEqual({ ...db.prepare("SELECT status, cert_ref_enc FROM links WHERE up = ?").get(up1) }, { status: "revoked", cert_ref_enc: null });
    await ownerData("reinstate", [up1]);
    await mine(3);
    await runIndexer({ db, provider: node.provider, address: badgeAddress, deployBlock });
    assert.equal(db.prepare("SELECT status FROM links WHERE up = ?").get(up1).status, "invalidated");
    const events = db.prepare("SELECT kind FROM notifications ORDER BY id").all().map((r) => r.kind);
    assert.ok(events.includes("revoked") && events.includes("reinstated"));

    // re-running from the cursor finds nothing new; a stale event replayed does not roll the state back
    const again = await runIndexer({ db, provider: node.provider, address: badgeAddress, deployBlock });
    assert.equal(again.events, 0);
    db.prepare("DELETE FROM chain_cursor").run();
    await runIndexer({ db, provider: node.provider, address: badgeAddress, deployBlock });
    assert.equal(db.prepare("SELECT status FROM links WHERE up = ?").get(up1).status, "invalidated");
  });

  it("monitor: email on change only, reminder, all clear, daily summary", async () => {
    const dbPath = path.join(dir, "mon.db");
    const db = openDb(dbPath);
    const backupDir = path.join(dir, "backups");
    const trustDir = path.join(dir, "trust");
    mkdirSync(backupDir);
    mkdirSync(trustDir);
    const attesterAddress = new Wallet(attesterKey).address;
    const cfg = {
      network: "luksoTestnet",
      deployment: { chainId: 4201, address: badgeAddress, deployBlock },
      port: 1,
      backupDir,
      trustDir,
      attesterAddress,
      minAttesterBalance: parseEther("1"),
      digestHourUtc: 0,
      retryDelayMs: 10,
      healthRetryDelayMs: 1,
    };
    const stateFile = path.join(dir, "monitor-state.json");
    const sent = [];
    const mailer = { send: async (subject, text) => sent.push({ subject, text }) };
    let backendUp = true;
    let t = Date.parse("2026-10-15T07:00:00Z");
    const fetchHealth = async () => {
      if (!backendUp) throw new Error("ECONNREFUSED");
      return { ok: true, indexer: { at: t } };
    };
    const writeBackupStatus = (at) => writeFileSync(path.join(backupDir, "last-backup.json"), JSON.stringify({ at: new Date(at).toISOString(), file: "x" }));
    const run = (now) => runMonitor({ cfg, provider: node.provider, db, fetchHealth, mailer, stateFile, now });

    writeBackupStatus(t - HOUR);
    // first run: everything fine -> only the daily summary
    let r = await run(t);
    assert.deepEqual(r.findings, []);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /^\[INFO\] up-cie-link luksoTestnet: daily summary 2026-10-15$/);
    assert.match(sent[0].text, /active badges:/);

    // backend down -> one PROBLEM email
    backendUp = false;
    t += HOUR;
    r = await run(t);
    assert.deepEqual(r.findings.map((f) => f.id), ["backend_down"]);
    assert.equal(sent.length, 2);
    assert.match(sent[1].subject, /^\[PROBLEM\]/);
    assert.match(sent[1].text, /PROBLEMS \(act now\)/);

    // same problem one hour later -> no email; 24 h later -> reminder
    t += HOUR;
    await run(t);
    assert.equal(sent.length, 2);
    t += 24 * HOUR;
    writeBackupStatus(t - HOUR);
    await run(t);
    assert.ok(sent.slice(2).some((m) => /^\[REMINDER\]/.test(m.subject)));
    assert.ok(sent.slice(2).some((m) => /daily summary 2026-10-16/.test(m.subject)));
    const count = sent.length;

    // fixed -> all clear
    backendUp = true;
    t += HOUR;
    await run(t);
    assert.equal(sent.length, count + 1);
    assert.match(sent.at(-1).subject, /^\[OK\]/);

    // a failing mail server: the monitor does not stop and tries the same message again next time
    cfg.retryDelayMs = 1;
    const failing = { send: async () => { throw Object.assign(new Error("dns"), { code: "EDNS", hostname: "smtps.example" }); } };
    backendUp = false;
    t += HOUR;
    r = await runMonitor({ cfg, provider: node.provider, db, fetchHealth, mailer: failing, stateFile, now: t });
    assert.deepEqual(r.mailErrors, ["EDNS smtps.example"]);
    const before = sent.length;
    t += HOUR;
    await run(t); // working mailer again: the PROBLEM mail is sent now
    assert.equal(sent.length, before + 1);
    assert.match(sent.at(-1).subject, /^\[PROBLEM\]/);
    backendUp = true;
    t += HOUR;
    await run(t);
    assert.match(sent.at(-1).subject, /^\[OK\]/);

    // low attester balance and old backup are problems
    cfg.minAttesterBalance = parseEther("100000000");
    t += 48 * HOUR;
    r = await run(t);
    const ids = r.findings.map((f) => f.id).sort();
    assert.deepEqual(ids, ["attester_low_balance", "backup_old"]);
    db.close();
  });
});
