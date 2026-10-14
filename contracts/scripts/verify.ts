// Verifies the recorded deployment and marks it as verified in deployments/<network>.json.
// Tries Blockscout first, then Sourcify (Blockscout also shows Sourcify-verified sources).
//
//   npx hardhat run scripts/verify.ts --network luksoTestnet
//   VERIFY_PROVIDER=sourcify npx hardhat run scripts/verify.ts --network luksoTestnet
import { readFileSync, writeFileSync } from "node:fs";
import hre, { network } from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { deploymentFile } from "./networks.js";

type Provider = "blockscout" | "sourcify";

const { networkName } = await network.create();
const file = deploymentFile(networkName);
const record = JSON.parse(readFileSync(file, "utf8"));
const providers = (process.env.VERIFY_PROVIDER ?? "blockscout,sourcify").split(",").map((p) => p.trim()) as Provider[];

const verifiedOn: string[] = record.verifiedOn ?? [];
for (const provider of providers) {
  console.log(`\nVerifying ${record.contract} at ${record.address} on ${networkName} with ${provider}`);
  try {
    const ok = await verifyContract(
      {
        address: record.address,
        constructorArgs: [record.owner, record.attester],
        contract: record.contract,
        provider,
        creationTxHash: record.txHash,
      },
      hre,
    );
    if (ok) {
      console.log(`OK: verified on ${provider}`);
      if (!verifiedOn.includes(provider)) verifiedOn.push(provider);
      break;
    }
    console.log(`Not verified on ${provider}`);
  } catch (e) {
    console.log(`Failed on ${provider}: ${(e as Error).message}`);
  }
}

if (verifiedOn.length === 0) {
  console.log(`\nNot verified. Manual fallback: npx hardhat run scripts/export-standard-json.ts --network ${networkName}`);
  process.exit(1);
}
record.verified = true;
record.verifiedOn = verifiedOn;
writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
console.log(`Updated deployments/${networkName}.json (verifiedOn: ${verifiedOn.join(", ")})`);
