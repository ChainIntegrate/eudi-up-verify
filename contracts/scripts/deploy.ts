// Deploys UpCieBadge.
//
// Usage (LUKSO testnet):
//   OWNER_UP=0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C ATTESTER=0x... \
//   LUKSO_TESTNET_RPC_URL=... DEPLOYER_PRIVATE_KEY=... \
//   npx hardhat run scripts/deploy.ts --network luksoTestnet
//
// The deployer key only pays for the deployment: ownership goes to OWNER_UP in the constructor.
import { network } from "hardhat";

const INTERFACE_ID_LSP0 = "0x24871b3d";
const EXPECTED_CHAIN_ID = { luksoTestnet: 4201n } as Record<string, bigint>;

const { ethers, networkName } = await network.create();

const ownerUp = process.env.OWNER_UP ?? "";
const attester = process.env.ATTESTER ?? "";
if (!ethers.isAddress(ownerUp) || !ethers.isAddress(attester)) {
  throw new Error("Set OWNER_UP and ATTESTER to valid addresses");
}

const { chainId } = await ethers.provider.getNetwork();
const expected = EXPECTED_CHAIN_ID[networkName];
if (expected !== undefined && chainId !== expected) {
  throw new Error(`Wrong chain: expected ${expected}, got ${chainId}`);
}

// The owner must be a Universal Profile (LSP0).
const erc165 = new ethers.Contract(ownerUp, ["function supportsInterface(bytes4) view returns (bool)"], ethers.provider);
let isUp = false;
try {
  isUp = await erc165.supportsInterface(INTERFACE_ID_LSP0);
} catch {
  isUp = false;
}
if (!isUp) throw new Error(`OWNER_UP ${ownerUp} is not a Universal Profile (LSP0) on chain ${chainId}`);

if (ethers.getAddress(attester) === ethers.getAddress(ownerUp)) {
  throw new Error("ATTESTER must be a dedicated operational key, not the owner UP");
}

const [deployer] = await ethers.getSigners();
console.log(`Network ${networkName} (chainId ${chainId}), deployer ${deployer.address}`);
console.log(`Owner UP ${ownerUp} (LSP0 ok), attester ${attester}`);

const badge = await ethers.deployContract("UpCieBadge", [ownerUp, attester]);
const receipt = await badge.deploymentTransaction()!.wait();
const address = await badge.getAddress();

console.log(`UpCieBadge deployed at ${address}`);
console.log(`DEPLOY_BLOCK=${receipt!.blockNumber}`);
console.log(`tx ${receipt!.hash}`);
console.log(`Verify: npx hardhat verify blockscout --network ${networkName} ${address} ${ownerUp} ${attester}`);
