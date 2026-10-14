// Generates a fresh key pair (e.g. for the attester or the deployer).
// The private key is printed ONCE: store it immediately in a secret manager
// (Codespaces secret, Hardhat keystore, server .env with restricted permissions) and clear the terminal.
//
//   node scripts/new-key.mjs
import { Wallet } from "ethers";

const wallet = Wallet.createRandom();
console.log(`Address:     ${wallet.address}`);
console.log(`Private key: ${wallet.privateKey}`);
console.log("\nStore the private key now; it is not saved anywhere. Never commit it or paste it in a chat.");
