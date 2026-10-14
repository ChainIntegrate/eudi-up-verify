# UP CIE Link — contracts

`UpCieBadge` is a soulbound LSP8 badge (one token per Universal Profile) stating that the UP was linked to a valid
Italian CIE. No personal data on-chain: only source, verification time, expiry and status.
Design and decisions: `../docs/01-contratto.md`.

- Solidity 0.8.28, viaIR, optimizer 200 runs, EVM `paris`; Hardhat 3, ethers v6.
- `@lukso/lsp8-contracts` 0.18.1, `@lukso/lsp4-contracts` 0.17.3 (pinned).
- LSP4TokenType = 1 (NFT), LSP8TokenIdFormat = 2 (ADDRESS): `tokenId = bytes32(uint256(uint160(up)))`.

## Roles

| Role | Who | Can |
|---|---|---|
| owner | ChainIntegrate UP | `revoke`, `reinstate`, `setAttester` (zero = emergency stop), `approveException`, ERC725Y metadata |
| attester | backend operational key | `attest` (mint or renew), `invalidate` |
| holder | the badge UP | `renounce` |

Transfers, burns and operators always revert.

## Commands

```bash
npm ci
npx hardhat build
npx hardhat test

# deploy to LUKSO testnet (chainId 4201)
export LUKSO_TESTNET_RPC_URL=...      # dedicated RPC endpoint
export DEPLOYER_PRIVATE_KEY=...       # only pays gas; never the owner or attester key
OWNER_UP=0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C ATTESTER=0x... \
  npx hardhat run scripts/deploy.ts --network luksoTestnet

# verify on Blockscout (command printed by the deploy script)
npx hardhat verify blockscout --network luksoTestnet <address> <ownerUp> <attester>
```

The deploy script refuses to run if the chain is not 4201 on `luksoTestnet`, if `OWNER_UP` is not an LSP0
Universal Profile, or if the attester equals the owner. It prints `DEPLOY_BLOCK` for the backend.
