// Starts a local Hardhat node from ../contracts for integration tests and exposes the compiled artifacts.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { JsonRpcProvider, NonceManager, Wallet } from "ethers";

/** Asks the OS for a free TCP port (tests run in parallel: random ports could collide). */
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const contractsDir = fileURLToPath(new URL("../../../contracts/", import.meta.url));
const hardhatBin = `${contractsDir}node_modules/.bin/hardhat`;
const artifactPath = (rel) => `${contractsDir}artifacts/contracts/${rel}`;
export const ARTIFACTS = {
  universalProfile: artifactPath("test/TestHelpers.sol/TestUniversalProfile.json"),
  badge: artifactPath("UpCieBadge.sol/UpCieBadge.json"),
};
export const contractsAvailable = existsSync(hardhatBin) && Object.values(ARTIFACTS).every(existsSync);
export const artifact = (name) => JSON.parse(readFileSync(ARTIFACTS[name], "utf8"));

export async function startNode({ chainId } = {}) {
  const port = await freePort();
  const args = ["node", "--port", String(port)];
  if (chainId) args.push("--chain-id", String(chainId));
  const node = spawn(hardhatBin, args, { cwd: contractsDir, stdio: ["ignore", "pipe", "pipe"] });
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
  const keys = [...log.matchAll(/Private Key: (0x[0-9a-f]{64})/g)].map((m) => m[1]);
  const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`);
  return {
    url: `http://127.0.0.1:${port}`,
    provider,
    wallets: keys.slice(0, 5).map((k) => new NonceManager(new Wallet(k, provider))),
    keys,
    stop: () => node.kill("SIGTERM"),
  };
}
