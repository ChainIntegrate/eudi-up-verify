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

  it("a key that is not the attester cannot mint", async () => {
    const intruder = createMinter(node.provider, badgeAddress, node.keys[2]);
    await assert.rejects(intruder.attest(up1, Math.floor(Date.now() / 1000) + 1000, true));
  });
});
