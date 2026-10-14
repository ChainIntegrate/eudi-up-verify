import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, type HardhatUserConfig } from "hardhat/config";

// Load contracts/.env if present (git-ignored; template in .env.example).
// Variables already set in the environment (e.g. Codespaces secrets) take precedence.
const envFile = fileURLToPath(new URL("./.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    version: "0.8.28",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
    },
  },
  networks: {
    luksoTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 4201,
      url: configVariable("LUKSO_TESTNET_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    luksoMainnet: {
      type: "http",
      chainType: "l1",
      chainId: 42,
      url: configVariable("LUKSO_MAINNET_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
  chainDescriptors: {
    42: {
      name: "LUKSO Mainnet",
      blockExplorers: {
        blockscout: {
          name: "LUKSO Mainnet Blockscout",
          url: "https://explorer.execution.mainnet.lukso.network",
          apiUrl: "https://explorer.execution.mainnet.lukso.network/api",
        },
      },
    },
    4201: {
      name: "LUKSO Testnet",
      blockExplorers: {
        blockscout: {
          name: "LUKSO Testnet Blockscout",
          url: "https://explorer.execution.testnet.lukso.network",
          apiUrl: "https://explorer.execution.testnet.lukso.network/api",
        },
      },
    },
  },
  verify: {
    blockscout: { enabled: true },
    etherscan: { enabled: false },
    sourcify: { enabled: false },
  },
};

export default config;
