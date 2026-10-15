// Integration: the real minter (attester key) against UpCieBadge deployed on a local Hardhat node,
// minting to a real LSP0 Universal Profile. Skipped when ../contracts has not been built.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ContractFactory, Wallet } from "ethers";
import { createBadgeReader, createMinter } from "../src/chain.js";
import { artifact, contractsAvailable, startNode } from "./helpers/hardhat-node.js";

describe("minter on a real UpCieBadge", { skip: !contractsAvailable && "contracts not built" }, () => {
  let node, badgeAddress, up1, up2, attesterKey;

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
  });

  after(() => node?.stop());

  it("attests primary and additional badges, reads them back, invalidates", async () => {
    const minter = createMinter(node.provider, badgeAddress, attesterKey);
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
    const minter = createMinter(node.provider, badgeAddress, attesterKey);
    const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
    const fresh = Wallet.createRandom().address;
    // invalidate() of a UP without a valid badge reverts: caught by the simulation, nothing is sent
    await assert.rejects(minter.invalidate(fresh, "INVALIDATED"), (e) => e.code === "SIMULATION_REVERTED");
    await assert.rejects(minter.invalidate(fresh, "INVALIDATED"), (e) => e.code === "SIMULATION_REVERTED");
    assert.match(await minter.attest(up2, exp, false), /^0x[0-9a-f]{64}$/);
  });

  it("UCL-01: a transaction not mined in time is reported with its hash and does not block the next one", async () => {
    const minter = createMinter(node.provider, badgeAddress, attesterKey, { timeoutMs: 1500 });
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
    const intruder = createMinter(node.provider, badgeAddress, node.keys[2]);
    await assert.rejects(intruder.attest(up1, Math.floor(Date.now() / 1000) + 1000, true));
  });
});
