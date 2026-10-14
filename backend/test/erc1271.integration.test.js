// Integration: ERC-1271 against a real LSP0 Universal Profile on a local Hardhat node (from ../contracts).
// The UP here is owned directly by an EOA; production UPs are owned by a Key Manager (LSP6), which applies the
// same EIP-191 hash + ecrecover and additionally requires the SIGN permission (checked on testnet).
// Skipped when ../contracts has not been built (run `npx hardhat build` there).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";
import { createUpChecker } from "../src/up.js";

const contractsDir = fileURLToPath(new URL("../../contracts/", import.meta.url));
const artifact = `${contractsDir}artifacts/contracts/test/TestHelpers.sol/TestUniversalProfile.json`;
const hardhatBin = `${contractsDir}node_modules/.bin/hardhat`;
const available = existsSync(artifact) && existsSync(hardhatBin);
const PORT = 8600 + Math.floor(Math.random() * 300);

describe("ERC-1271 on a real LSP0 Universal Profile", { skip: !available && "contracts not built" }, () => {
  let node, provider, deployer, controller, up;

  before(async () => {
    node = spawn(hardhatBin, ["node", "--port", String(PORT)], { cwd: contractsDir, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("hardhat node did not start")), 60_000);
      node.stdout.on("data", (d) => {
        log += d;
        if (/Private Key: 0x[0-9a-f]{64}/.test(log)) {
          clearTimeout(timer);
          resolve();
        }
      });
      node.on("exit", (c) => reject(new Error(`hardhat node exited ${c}`)));
    });
    const key = log.match(/Private Key: (0x[0-9a-f]{64})/)[1];
    provider = new JsonRpcProvider(`http://127.0.0.1:${PORT}`);
    deployer = new Wallet(key, provider);
    controller = Wallet.createRandom();
    const { abi, bytecode } = JSON.parse(readFileSync(artifact, "utf8"));
    const c = await new ContractFactory(abi, bytecode, deployer).deploy(controller.address);
    await c.waitForDeployment();
    up = await c.getAddress();
  });

  after(() => node?.kill("SIGTERM"));

  it("recognises the UP and rejects an EOA", async () => {
    const checker = createUpChecker(provider);
    assert.equal(await checker.isUniversalProfile(up), true);
    assert.equal(await checker.isUniversalProfile(controller.address), false);
  });

  it("accepts the controller's EIP-191 signature and rejects others", async () => {
    const checker = createUpChecker(provider);
    const text = "up-cie-link statement v1\nUniversal-Profile: " + up;
    assert.equal(await checker.isValidUpSignature(up, text, await controller.signMessage(text)), true);
    assert.equal(await checker.isValidUpSignature(up, text, await Wallet.createRandom().signMessage(text)), false);
    assert.equal(await checker.isValidUpSignature(up, text + "x", await controller.signMessage(text)), false);
    assert.equal(await checker.isValidUpSignature(up, text, "0x1234"), false);
  });
});
