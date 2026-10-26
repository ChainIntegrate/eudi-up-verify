// Integration: the real minter against UpCieBadge deployed on a local Hardhat node, minting to a real LSP0
// Universal Profile; the attester key is in the signer (UCL-08), in process or as the real program on a socket.
// Skipped when ../contracts has not been built.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContractFactory, Wallet } from "ethers";
import { createBadgeReader, createMinter } from "../src/chain.js";
import { createSigner, socketTransport } from "../src/signer.js";
import { artifact, contractsAvailable, startNode } from "./helpers/hardhat-node.js";
import { startSignerProcess, testSigner } from "./helpers/signer.js";

describe("minter on a real UpCieBadge", { skip: !contractsAvailable && "contracts not built" }, () => {
  let node, badgeAddress, up1, up2, attesterKey, chainId;
  /** A minter whose key is held by an in-process signer for `key` (default: the attester). */
  const minterFor = (key = attesterKey, opts, signerOpts = {}) => {
    const { signer, address } = testSigner({ attesterKey: key, contract: badgeAddress, chainId, ...signerOpts });
    return createMinter(node.provider, badgeAddress, signer, () => address, opts);
  };

  before(async () => {
    node = await startNode();
    const [deployer] = node.wallets;
    attesterKey = node.keys[1];
    const upArt = artifact("universalProfile");
    const deployUp = async () => {
      const c = await new ContractFactory(upArt.abi, upArt.bytecode, deployer).deploy(Wallet.createRandom().address);
      await c.waitForDeployment();
      return c.getAddress();
    };
    const owner = await deployUp();
    up1 = await deployUp();
    up2 = await deployUp();
    const b = artifact("badge");
    const badge = await new ContractFactory(b.abi, b.bytecode, deployer).deploy(owner, new Wallet(attesterKey).address);
    await badge.waitForDeployment();
    badgeAddress = await badge.getAddress();
    chainId = Number((await node.provider.getNetwork()).chainId);
  });

  after(() => node?.stop());

  it("attests primary and additional badges, reads them back, invalidates", async () => {
    const minter = minterFor();
    const reader = createBadgeReader(node.provider, badgeAddress);
    assert.equal((await reader.attester()).toLowerCase(), minter.address.toLowerCase());

    const expires = Math.floor(Date.now() / 1000) + 365 * 86400;
    const tx1 = await minter.attest(up1, expires, true);
    const tx2 = await minter.attest(up2, expires, false);
    assert.match(tx1, /^0x[0-9a-f]{64}$/);
    assert.notEqual(tx1, tx2);

    assert.equal(await reader.isVerified(up1), true);
    assert.equal(await reader.isVerifiedPrimary(up1), true);
    assert.equal(await reader.isVerified(up2), true);
    assert.equal(await reader.isVerifiedPrimary(up2), false);
    const a = await reader.getAttestation(up1);
    assert.equal(Number(a.expiresAt), expires);
    assert.equal(Number(a.status), 1);

    await minter.invalidate(up1, "MIGRATED");
    assert.equal(await reader.isVerified(up1), false);
    assert.equal(Number(await reader.exceptionOf(`0x${"11".repeat(32)}`)), 0);
  });

  it("UCL-01: a reverted call does not break the following mints (no nonce gap)", async () => {
    const minter = minterFor();
    const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
    const fresh = Wallet.createRandom().address;
    // invalidate() of a UP without a valid badge reverts: caught by the simulation, nothing is sent
    await assert.rejects(minter.invalidate(fresh, "INVALIDATED"), (e) => e.code === "SIMULATION_REVERTED");
    await assert.rejects(minter.invalidate(fresh, "INVALIDATED"), (e) => e.code === "SIMULATION_REVERTED");
    assert.match(await minter.attest(up2, exp, false), /^0x[0-9a-f]{64}$/);
  });

  it("UCL-01: a transaction not mined in time is reported with its hash and does not block the next one", async () => {
    const minter = minterFor(attesterKey, { timeoutMs: 1500 });
    const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
    await node.provider.send("evm_setAutomine", [false]);
    let sent = null;
    try {
      await assert.rejects(
        minter.attest(up1, exp, true, { onSent: (h) => (sent = h) }),
        (e) => e.code === "TX_TIMEOUT" && e.txHash === sent && /^0x[0-9a-f]{64}$/.test(sent),
      );
    } finally {
      await node.provider.send("evm_setAutomine", [true]);
    }
    await node.provider.send("evm_mine", []);
    // the next transaction takes the next nonce and is mined
    assert.match(await minter.attest(up2, exp, false), /^0x[0-9a-f]{64}$/);
    const receipt = await node.provider.getTransactionReceipt(sent);
    assert.equal(receipt.status, 1);
  });

  it("a key that is not the attester cannot mint", async () => {
    const intruder = minterFor(node.keys[2]);
    await assert.rejects(intruder.attest(up1, Math.floor(Date.now() / 1000) + 1000, true));
  });

  it("UCL-08: the signer's mint limit stops minting with MINT_RATE_LIMITED, nothing sent", async () => {
    const minter = minterFor(attesterKey, {}, { limits: { attestPerHour: 1 } });
    const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
    assert.match(await minter.attest(up1, exp, true), /^0x[0-9a-f]{64}$/);
    const nonce = await node.provider.getTransactionCount(new Wallet(attesterKey).address);
    await assert.rejects(minter.attest(up2, exp, false), (e) => e.code === "MINT_RATE_LIMITED");
    assert.equal(await node.provider.getTransactionCount(new Wallet(attesterKey).address), nonce);
  });

  it("UCL-08: a signer set up for another contract refuses to sign (SIGNER_REFUSED)", async () => {
    const { signer, address } = testSigner({ attesterKey, contract: Wallet.createRandom().address, chainId });
    const minter = createMinter(node.provider, badgeAddress, signer, () => address);
    await assert.rejects(minter.attest(up1, Math.floor(Date.now() / 1000) + 1000, true), (e) => e.code === "SIGNER_REFUSED");
  });

  it("UCL-08: the real signer program on its socket signs a mint; without it: SIGNER_UNAVAILABLE", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "signer-"));
    const proc = await startSignerProcess(dir, { attesterKey, contract: badgeAddress, chainId });
    try {
      const signer = createSigner(socketTransport(proc.socketPath));
      const { address } = await signer.hello();
      const minter = createMinter(node.provider, badgeAddress, signer, () => address);
      assert.match(await minter.attest(up1, Math.floor(Date.now() / 1000) + 365 * 86400, true), /^0x[0-9a-f]{64}$/);
      assert.ok(!proc.logs().match(/0x[0-9a-fA-F]{64}/), "the signer logs no keys or transactions");
    } finally {
      proc.stop();
    }
    await new Promise((r) => setTimeout(r, 200));
    const gone = createSigner(socketTransport(path.join(dir, "signer.sock"), { timeoutMs: 1000 }));
    const minter = createMinter(node.provider, badgeAddress, gone, () => new Wallet(attesterKey).address);
    await assert.rejects(minter.attest(up2, Math.floor(Date.now() / 1000) + 1000, false), (e) => e.code === "SIGNER_UNAVAILABLE");
    rmSync(dir, { recursive: true, force: true });
  });
});
