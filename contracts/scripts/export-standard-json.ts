// Manual verification fallback: exports the Solidity "Standard JSON input" used to compile UpCieBadge,
// to upload in the Blockscout UI (Contract -> Verify & publish -> Solidity (Standard JSON input)).
//
//   npx hardhat run scripts/export-standard-json.ts --network luksoTestnet
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import hre, { network } from "hardhat";
import { deploymentFile } from "./networks.js";

const { ethers, networkName } = await network.create();
const record = JSON.parse(readFileSync(deploymentFile(networkName), "utf8"));

await hre.tasks.getTask("build").run({ quiet: true });

const dir = fileURLToPath(new URL("../artifacts/build-info/", import.meta.url));
const buildInfos = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".output.json"))
  .map((f) => JSON.parse(readFileSync(dir + f, "utf8")))
  .filter((b) => Object.keys(b.input.sources).some((s: string) => s.endsWith("contracts/UpCieBadge.sol")));
if (buildInfos.length !== 1) throw new Error(`Expected one build-info for UpCieBadge, found ${buildInfos.length}`);
const bi = buildInfos[0];

const outDir = fileURLToPath(new URL("../verify-input/", import.meta.url));
mkdirSync(outDir, { recursive: true });
const out = `${outDir}${networkName}-UpCieBadge.standard-input.json`;
writeFileSync(out, JSON.stringify(bi.input));

const sourceName = Object.keys(bi.input.sources).find((s: string) => s.endsWith("contracts/UpCieBadge.sol"));
const ctorArgs = ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [record.owner, record.attester]);
console.log(`Written    ${out}`);
console.log(`Address    ${record.address}`);
console.log(`Compiler   v${bi.solcLongVersion}`);
console.log(`Contract   ${sourceName}:UpCieBadge  (name in the UI: UpCieBadge)`);
console.log(`Settings   viaIR ${bi.input.settings.viaIR}, optimizer ${JSON.stringify(bi.input.settings.optimizer)}, evm ${bi.input.settings.evmVersion}`);
console.log(`Ctor args  ${ctorArgs.slice(2)}  (ABI-encoded, without 0x)`);
