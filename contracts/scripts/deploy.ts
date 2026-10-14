// Deploys UpCieBadge and records the deployment in deployments/<network>.json.
//
//   npx hardhat run scripts/deploy.ts --network luksoTestnet
//   CONFIRM_MAINNET=yes npx hardhat run scripts/deploy.ts --network luksoMainnet
//
// Required: ATTESTER (address of the backend operational key), plus the network configuration variables
// (LUKSO_TESTNET_RPC_URL / LUKSO_MAINNET_RPC_URL and DEPLOYER_PRIVATE_KEY) as env vars or in the Hardhat keystore.
// Optional: OWNER_UP to override the owner UP set in scripts/networks.ts.
//
// The deployer key only pays for the deployment: ownership goes to the owner UP in the constructor.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { network } from "hardhat";
import { CONTRACT_FQN, TARGETS, deploymentFile } from "./networks.js";

const INTERFACE_ID_LSP0 = "0x24871b3d";
const LSP4_TOKEN_TYPE_KEY = "0xe0261fa95db2eb3b5439bd033cda66d56b96f92f243a8228fd87550ed7bdfdb3";

const { ethers, networkName } = await network.create();
const target = TARGETS[networkName];
const isLocal = target === undefined;

// ---- inputs ----
const ownerUp = process.env.OWNER_UP || target?.ownerUp || "";
const attester = process.env.ATTESTER || "";
if (!ethers.isAddress(ownerUp)) throw new Error("OWNER_UP missing or invalid (local networks need it explicitly)");
if (!ethers.isAddress(attester)) throw new Error("ATTESTER missing or invalid");
if (ethers.getAddress(attester) === ethers.getAddress(ownerUp)) {
  throw new Error("ATTESTER must be a dedicated operational key, not the owner UP");
}
if (target && ethers.getAddress(ownerUp) !== ethers.getAddress(target.ownerUp)) {
  console.warn(`WARNING: OWNER_UP overrides the configured owner for ${networkName} (${target.ownerUp})`);
}

// ---- chain checks ----
const { chainId } = await ethers.provider.getNetwork();
if (target && chainId !== target.chainId) {
  throw new Error(`Wrong chain for ${networkName}: expected ${target.chainId}, got ${chainId}`);
}
if (target?.mainnet && process.env.CONFIRM_MAINNET !== "yes") {
  throw new Error("Mainnet deployment: set CONFIRM_MAINNET=yes to proceed");
}
const outFile = isLocal ? undefined : deploymentFile(networkName);
if (outFile && existsSync(outFile) && process.env.REDEPLOY !== "yes") {
  throw new Error(`A deployment already exists in deployments/${networkName}.json. Set REDEPLOY=yes to deploy a new one`);
}

// The owner must be a Universal Profile (LSP0).
const erc165 = new ethers.Contract(ownerUp, ["function supportsInterface(bytes4) view returns (bool)"], ethers.provider);
const isUp = await erc165.supportsInterface(INTERFACE_ID_LSP0).catch(() => false);
if (!isUp) throw new Error(`Owner ${ownerUp} is not a Universal Profile (LSP0) on chain ${chainId}`);

const [deployer] = await ethers.getSigners();
const balance = await ethers.provider.getBalance(deployer.address);
console.log(`Network    ${networkName} (chainId ${chainId})`);
console.log(`Deployer   ${deployer.address} (balance ${ethers.formatEther(balance)} LYX)`);
console.log(`Owner UP   ${ownerUp} (LSP0 ok)`);
console.log(`Attester   ${attester}`);
if (balance === 0n) throw new Error("Deployer has no balance");

// ---- deploy ----
const badge = await ethers.deployContract("UpCieBadge", [ownerUp, attester]);
const tx = badge.deploymentTransaction()!;
console.log(`Deploying... tx ${tx.hash}`);
const receipt = (await tx.wait(target?.mainnet ? 2 : 1))!;
const address = await badge.getAddress();

// ---- post-deploy checks ----
const abi = ethers.AbiCoder.defaultAbiCoder();
const checks = {
  owner: (await badge.owner()) === ethers.getAddress(ownerUp),
  attester: (await badge.attester()) === ethers.getAddress(attester),
  tokenType: abi.decode(["uint256"], await badge.getData(LSP4_TOKEN_TYPE_KEY))[0] === 1n,
};
if (!Object.values(checks).every(Boolean)) throw new Error(`Post-deploy checks failed: ${JSON.stringify(checks)}`);

console.log(`\nUpCieBadge ${address}`);
console.log(`DEPLOY_BLOCK=${receipt.blockNumber}`);
if (target) console.log(`Explorer   ${target.explorer}/address/${address}`);

// ---- record (public data only) ----
if (outFile) {
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {}
  // Keep the history: a previous deployment of this network moves into "superseded".
  const file = fileURLToPath(outFile);
  let superseded: unknown[] = [];
  if (existsSync(file)) {
    const previous = JSON.parse(readFileSync(file, "utf8"));
    const { superseded: older = [], ...prev } = previous;
    superseded = [prev, ...older];
  }
  const record = {
    network: networkName,
    chainId: Number(chainId),
    contract: CONTRACT_FQN,
    address,
    deployBlock: receipt.blockNumber,
    txHash: receipt.hash,
    owner: ethers.getAddress(ownerUp),
    attester: ethers.getAddress(attester),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    gitCommit: commit,
    verified: false,
    superseded,
  };
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  console.log(`Saved      deployments/${networkName}.json`);
  console.log(`\nNext: npx hardhat run scripts/verify.ts --network ${networkName}`);
}
