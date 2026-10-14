// Per-network deployment settings shared by the deploy and verify scripts.
// Addresses here are public (owner UPs); never put private keys in this file.

export interface DeployTarget {
  chainId: bigint;
  ownerUp: string;
  explorer: string;
  mainnet: boolean;
}

export const TARGETS: Record<string, DeployTarget> = {
  luksoTestnet: {
    chainId: 4201n,
    ownerUp: "0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C",
    explorer: "https://explorer.execution.testnet.lukso.network",
    mainnet: false,
  },
  luksoMainnet: {
    chainId: 42n,
    ownerUp: "0x4a2605796e0d91A9667d6E30365aEEC384C48c27",
    explorer: "https://explorer.execution.mainnet.lukso.network",
    mainnet: true,
  },
};

export const CONTRACT_FQN = "contracts/UpCieBadge.sol:UpCieBadge";

export const deploymentFile = (networkName: string) =>
  new URL(`../deployments/${networkName}.json`, import.meta.url);
