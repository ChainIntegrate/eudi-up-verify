# UP CIE Link — contracts

`UpCieBadge` is a soulbound LSP8 badge (one token per Universal Profile) stating that the UP was linked to a valid
Italian CIE. No personal data on-chain: only source, verification time, expiry and status.
Design and decisions: [`../docs/01-contratto.md`](../docs/01-contratto.md).

- Solidity 0.8.28, viaIR, optimizer 200 runs, EVM `paris`; Hardhat 3, ethers v6.
- `@lukso/lsp8-contracts` 0.18.1, `@lukso/lsp4-contracts` 0.17.3 (pinned).
- LSP4TokenType = 1 (NFT), LSP8TokenIdFormat = 2 (ADDRESS): `tokenId = bytes32(uint256(uint160(up)))`.

## Roles

| Role | Who | Can |
|---|---|---|
| owner | ChainIntegrate UP | `revoke`, `reinstate`, `setAttester` (zero address = emergency stop), `approveException`, ERC725Y metadata |
| attester | backend operational key | `attest` (mint or renew), `invalidate` |
| holder | the badge UP | `renounce` |

Transfers, burns and operators always revert.

## Networks

| Hardhat network | Chain | Owner UP (in `scripts/networks.ts`) | Explorer |
|---|---|---|---|
| `luksoTestnet` | 4201 | `0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C` | explorer.execution.testnet.lukso.network |
| `luksoMainnet` | 42 | `0x4a2605796e0d91A9667d6E30365aEEC384C48c27` | explorer.execution.mainnet.lukso.network |

## Keys and configuration

| Name | What |
|---|---|
| `LUKSO_TESTNET_RPC_URL`, `LUKSO_MAINNET_RPC_URL` | RPC endpoints dedicated to this service |
| `DEPLOYER_PRIVATE_KEY` | pays deployment gas only; no role in the contract (testnet LYX from the faucet) |
| `ATTESTER` | **address** of the backend key that mints badges (its private key lives only on the backend server) |

Two ways to provide them, use either:

- **`.env` file**: `cp .env.example .env` in this folder and fill it in. It is git-ignored and loaded by
  `hardhat.config.ts`.
- **Codespaces secrets** (GitHub → Settings → Codespaces → Secrets, with access to this repository): they become
  environment variables and take precedence over `.env`.

Generate a key with `npm run new-key` (prints the private key once; store it immediately, never commit it).

## Deploy from GitHub Codespaces

1. Open a codespace on `main`. The container installs dependencies and compiles (`postCreateCommand`).
2. In `contracts/`: `cp .env.example .env` and fill it in (or use Codespaces secrets, see above;
   if you add secrets while the codespace is running, restart it).
3. Run the tests: `npm test`.
4. Deploy and verify:

```bash
# testnet
npm run deploy:testnet     # checks chain 4201, owner is an LSP0 UP, attester != owner; writes deployments/luksoTestnet.json
npm run verify:testnet     # Blockscout verification; sets "verified": true in the same file

# mainnet (same flow, explicit confirmation required)
CONFIRM_MAINNET=yes npm run deploy:mainnet
npm run verify:mainnet
```

5. Commit `deployments/<network>.json` (public data: address, `deployBlock`, tx hash, commit). The backend reads
   `address` and `deployBlock` from it.

Safety rails in `scripts/deploy.ts`:
- refuses a wrong chain id for the selected network;
- refuses an owner that is not an LSP0 Universal Profile, and an attester equal to the owner;
- refuses to overwrite an existing `deployments/<network>.json` unless `REDEPLOY=yes`;
- on mainnet requires `CONFIRM_MAINNET=yes` and waits for 2 confirmations;
- after deploying, reads back owner, attester and LSP4TokenType and fails if they differ.

`OWNER_UP` can override the owner configured in `scripts/networks.ts` (a warning is printed).

## After deployment

- The owner UP can set the LSP4 metadata (name, description EN/IT, icon ≤ 800 px) with `setData`.
- To rotate the attester: `setAttester(newAddress)` from the owner UP; `setAttester(0x0)` stops all new badges.

## Commands

```bash
npm run build
npm test
npm run new-key
```
