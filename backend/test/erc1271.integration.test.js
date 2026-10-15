// Integration: ERC-1271 against a real LSP0 Universal Profile on a local Hardhat node (from ../contracts).
// The UP is owned by a minimal test Key Manager (same EIP-191 hash + ecrecover); the real LSP6 additionally requires
// the SIGN permission (checked on testnet).
// Skipped when ../contracts has not been built (run `npx hardhat build` there).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ContractFactory, Wallet } from "ethers";
import { createUpChecker } from "../src/up.js";
import { artifact, contractsAvailable, deployProfile, startNode } from "./helpers/hardhat-node.js";

describe("ERC-1271 on a real LSP0 Universal Profile", { skip: !contractsAvailable && "contracts not built" }, () => {
  let node, controller, up, eoaOwnedUp, fakeUp;

  before(async () => {
    node = await startNode();
    controller = Wallet.createRandom();
    ({ up } = await deployProfile(node.wallets[0], controller));
    const { abi, bytecode } = artifact("universalProfile");
    eoaOwnedUp = await (await (await new ContractFactory(abi, bytecode, node.wallets[0]).deploy(controller.address)).waitForDeployment()).getAddress();
    const f = artifact("fakeUpNoLsp1");
    fakeUp = await (await (await new ContractFactory(f.abi, f.bytecode, node.wallets[0]).deploy()).waitForDeployment()).getAddress();
  });

  after(() => node?.stop());

  it("recognises the UP and rejects an EOA", async () => {
    const checker = createUpChecker(node.provider);
    assert.equal(await checker.isUniversalProfile(up), true);
    assert.equal(await checker.isUniversalProfile(controller.address), false);
  });

  it("UCL-05: rejects contracts that only claim LSP0 (no Key Manager owning them)", async () => {
    const checker = createUpChecker(node.provider);
    assert.equal(await checker.isUniversalProfile(fakeUp), false);
    assert.equal(await checker.isUniversalProfile(eoaOwnedUp), false);
  });

  it("accepts the controller's EIP-191 signature and rejects others", async () => {
    const checker = createUpChecker(node.provider);
    const text = "up-cie-link statement v1\nUniversal-Profile: " + up;
    assert.equal(await checker.isValidUpSignature(up, text, await controller.signMessage(text)), true);
    assert.equal(await checker.isValidUpSignature(up, text, await Wallet.createRandom().signMessage(text)), false);
    assert.equal(await checker.isValidUpSignature(up, text + "x", await controller.signMessage(text)), false);
    assert.equal(await checker.isValidUpSignature(up, text, "0x1234"), false);
  });
});
