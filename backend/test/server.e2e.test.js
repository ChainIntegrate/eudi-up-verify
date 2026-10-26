// End-to-end: the real server process (src/server.js) with its real wiring:
// local chain 4201 + deployed UpCieBadge + real LSP0 UP + attester key + trust store from a directory +
// HTTP OCSP responder. Full flow over HTTP until the badge is minted on-chain.
// Skipped when ../contracts has not been built.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { ContractFactory, Wallet, randomBytes, hexlify } from "ethers";
import { createBadgeReader } from "../src/chain.js";
import { createFakePki } from "./helpers/fake-pki.js";
import { artifact, contractsAvailable, deployProfile, startNode } from "./helpers/hardhat-node.js";
import { startSignerProcess } from "./helpers/signer.js";

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

describe("server end-to-end", { skip: !contractsAvailable && "contracts not built" }, () => {
  let node, pki, stopOcsp, server, dir, base, up, controller, badgeAddress, env, deployer, ownerUp, attesterKey, signerProc, signerProcs = [], pepper, logs = "";

  before(async () => {
    node = await startNode({ chainId: 4201 });
    [deployer] = node.wallets;
    attesterKey = node.keys[1];
    controller = Wallet.createRandom();
    const upArt = artifact("universalProfile");
    const deployUp = async (ownerAddr) => {
      const c = await new ContractFactory(upArt.abi, upArt.bytecode, deployer).deploy(ownerAddr);
      await c.waitForDeployment();
      return c.getAddress();
    };
    ownerUp = await deployUp(Wallet.createRandom().address);
    ({ up } = await deployProfile(deployer, controller));
    const b = artifact("badge");
    const badge = await new ContractFactory(b.abi, b.bytecode, deployer).deploy(ownerUp, new Wallet(attesterKey).address);
    await badge.waitForDeployment();
    badgeAddress = await badge.getAddress();
    const deployBlock = await node.provider.getBlockNumber();

    const ocspPort = await freePort();
    pki = createFakePki({ ocspUrl: `http://127.0.0.1:${ocspPort}/` });
    stopOcsp = pki.serveOcsp(ocspPort);

    dir = mkdtempSync(path.join(tmpdir(), "e2e-"));
    mkdirSync(path.join(dir, "deployments"));
    mkdirSync(path.join(dir, "trust"));
    writeFileSync(path.join(dir, "deployments", "luksoTestnet.json"), JSON.stringify({ chainId: 4201, address: badgeAddress, deployBlock }));
    writeFileSync(path.join(dir, "trust", "root.pem"), pki.rootPem);
    writeFileSync(path.join(dir, "trust", "sub.pem"), pki.subPem);

    // UCL-08: the secrets are in the signer process, the backend only knows its socket
    pepper = hexlify(randomBytes(32));
    signerProc = await startSignerProcess(dir, { attesterKey, contract: badgeAddress, chainId: 4201, pepper });
    signerProcs.push(signerProc);
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    env = {
      ...process.env,
      SIGNER_SOCKET: signerProc.socketPath,
      NETWORK: "luksoTestnet",
      RPC_URL: node.url,
      PORT: String(port),
      PUBLIC_ORIGIN: "https://up-cie-link.example",
      DB_PATH: path.join(dir, "e2e.db"),
      DEPLOYMENTS_DIR: path.join(dir, "deployments"),
      TRUST_DIR: path.join(dir, "trust"),
      CIE_ROOT_SHA256: pki.rootSha256,
      ALLOW_CADES_UPLOAD: "true",
    };
    const serverJs = fileURLToPath(new URL("../src/server.js", import.meta.url));
    server = spawn(process.execPath, [serverJs], { env, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", (d) => (logs += d));
    server.stderr.on("data", (d) => (logs += d));
    for (let i = 0; i < 100 && !logs.includes("trust store:"); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(logs.includes("trust store: 1 root(s), 1 intermediate(s)"), `server did not start:\n${logs}`);
  });

  after(() => {
    server?.kill("SIGTERM");
    signerProcs.forEach((p) => p.stop());
    stopOcsp?.();
    node?.stop();
    pki?.cleanup();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("links the UP to the (fake) CIE and mints the badge on-chain", async () => {
    const s = await (await post("/api/statements", { up, mode: "link" })).json();
    assert.equal(s.status, "pending_up", JSON.stringify(s));
    const signed = await post(`/api/statements/${s.id}/up-signature`, { signature: await controller.signMessage(s.text) });
    assert.equal(signed.status, 200);

    const p7m = pki.signCades(Buffer.from(s.text, "ascii"));
    const sub = await fetch(`${base}/api/statements/${s.id}/cie-cades`, { method: "POST", body: p7m });
    assert.equal(sub.status, 202, JSON.stringify(await sub.clone().json()));

    let st;
    for (let i = 0; i < 100; i++) {
      st = await (await fetch(`${base}/api/statements/${s.id}`)).json();
      if (["done", "failed"].includes(st.status)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(st.status, "done", JSON.stringify(st));

    const reader = createBadgeReader(node.provider, badgeAddress);
    assert.equal(await reader.isVerifiedPrimary(up), true);
    const badge = await (await fetch(`${base}/api/badge/${up}`)).json();
    assert.equal(badge.verified, true);
    assert.equal(badge.verifiedPrimary, true);
    assert.equal(badge.status, "valid");

    // the server never logs the tax code or the RPC URL
    assert.ok(!logs.includes("RSSMRA80A01H501X"));
    assert.ok(!logs.includes(node.url));
  });

  it("starts after an emergency stop (attester zero) so that the admin page can restore it", async () => {
    const b = artifact("badge");
    const stopped = await new ContractFactory(b.abi, b.bytecode, deployer).deploy(ownerUp, "0x0000000000000000000000000000000000000000");
    await stopped.waitForDeployment();
    const d2 = path.join(dir, "deployments-stopped");
    mkdirSync(d2);
    writeFileSync(path.join(d2, "luksoTestnet.json"), JSON.stringify({ chainId: 4201, address: await stopped.getAddress(), deployBlock: await node.provider.getBlockNumber() }));
    const d2s = path.join(dir, "signer-stopped");
    mkdirSync(d2s);
    const stoppedSigner = await startSignerProcess(d2s, { attesterKey, contract: await stopped.getAddress(), chainId: 4201 });
    signerProcs.push(stoppedSigner);
    const port = await freePort();
    let out = "";
    const child = spawn(process.execPath, [fileURLToPath(new URL("../src/server.js", import.meta.url))], {
      env: { ...env, PORT: String(port), DEPLOYMENTS_DIR: d2, DB_PATH: path.join(dir, "stopped.db"), SIGNER_SOCKET: stoppedSigner.socketPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (x) => (out += x));
    child.stderr.on("data", (x) => (out += x));
    try {
      for (let i = 0; i < 100 && !out.includes("trust store:"); i++) await new Promise((r) => setTimeout(r, 100));
      assert.match(out, /Minting is STOPPED/);
      assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).ok, true);
    } finally {
      child.kill("SIGTERM");
    }
  });

  /** Starts a second backend with `extra` env; returns {port, out(), stop()} once it listens (or exited). */
  async function startBackend(extra) {
    const port = await freePort();
    let out = "";
    const child = spawn(process.execPath, [fileURLToPath(new URL("../src/server.js", import.meta.url))], {
      env: { ...env, PORT: String(port), ...extra },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let exited = null;
    child.on("exit", (c) => (exited = c));
    child.stdout.on("data", (x) => (out += x));
    child.stderr.on("data", (x) => (out += x));
    for (let i = 0; i < 100 && !out.includes("trust store:") && exited === null; i++) await new Promise((r) => setTimeout(r, 100));
    return { port, out: () => out, exited: () => exited, stop: () => child.kill("SIGTERM") };
  }

  it("UCL-08 (S3): the backend refuses to start with the signer's secrets in its environment", async () => {
    const b = await startBackend({ UNIQ_PEPPER: pepper, DB_PATH: path.join(dir, "s3.db") });
    assert.equal(b.exited(), 1);
    assert.match(b.out(), /UNIQ_PEPPER must not be in the backend's environment/);
  });

  it("UCL-08: a signer with another UNIQ_PEPPER is caught; the site stays up and refuses CIE files", async () => {
    const d = path.join(dir, "signer-other-pepper");
    mkdirSync(d);
    const other = await startSignerProcess(d, { attesterKey, contract: badgeAddress, chainId: 4201 }); // new pepper
    signerProcs.push(other);
    // same database as the main backend: its stored pepper check value does not match
    const b = await startBackend({ SIGNER_SOCKET: other.socketPath });
    try {
      assert.match(b.out(), /signer: PEPPER_MISMATCH/);
      const base2 = `http://127.0.0.1:${b.port}`;
      const s = await (await fetch(`${base2}/api/statements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ up, mode: "link" }) })).json();
      await fetch(`${base2}/api/statements/${s.id}/up-signature`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signature: await controller.signMessage(s.text) }) });
      const sub = await fetch(`${base2}/api/statements/${s.id}/cie-cades`, { method: "POST", body: pki.signCades(Buffer.from(s.text, "ascii")) });
      assert.equal(sub.status, 503);
      assert.equal((await sub.json()).error, "SERVICE_UNAVAILABLE");
      assert.equal((await (await fetch(`${base2}/api/statements/${s.id}`)).json()).status, "pending_cie", "the statement stays usable");
      assert.equal((await (await fetch(`${base2}/api/badge/${up}`)).json()).status, "valid", "the site still reads the chain");
    } finally {
      b.stop();
    }
  });

  it("UCL-08: a signer with another CERT_REF_KEY is caught at start-up (stored references no longer decrypt)", async () => {
    const d = path.join(dir, "signer-other-refkey");
    mkdirSync(d);
    const other = await startSignerProcess(d, { attesterKey, contract: badgeAddress, chainId: 4201, pepper }); // same pepper, new CERT_REF_KEY
    signerProcs.push(other);
    const b = await startBackend({ SIGNER_SOCKET: other.socketPath });
    try {
      assert.match(b.out(), /signer: CERT_REF_KEY_MISMATCH/);
      assert.deepEqual((await (await fetch(`http://127.0.0.1:${b.port}/api/health`)).json()).ok, true);
    } finally {
      b.stop();
    }
  });
});
