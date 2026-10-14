// Verifies the recorded deployment on Blockscout and marks it as verified.
//
//   npx hardhat run scripts/verify.ts --network luksoTestnet
import { readFileSync, writeFileSync } from "node:fs";
import hre, { network } from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { deploymentFile } from "./networks.js";

const { networkName } = await network.create();
const file = deploymentFile(networkName);
const record = JSON.parse(readFileSync(file, "utf8"));

console.log(`Verifying ${record.contract} at ${record.address} on ${networkName} (Blockscout)`);
const ok = await verifyContract(
  {
    address: record.address,
    constructorArgs: [record.owner, record.attester],
    contract: record.contract,
    provider: "blockscout",
  },
  hre,
);
if (!ok) throw new Error("Verification failed");

record.verified = true;
writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
console.log(`Verified. Updated deployments/${networkName}.json`);
