# up-cie-link — working rules

Links a LUKSO Universal Profile to an Italian CIE (signature of a joint statement), with a soulbound
LSP8 badge and no personal data on-chain. Analysis and decisions: `docs/00-analisi.md`.

## Process
- Discuss and confirm before implementing; one phase at a time. State clearly what is verified and what is not.
- Every question/decision needs an explicit confirmation from the owner. Silence is NOT approval: if an item
  was not answered, ask it again before acting on it.
- Conversation and docs in Italian; **commit messages in English**; README in English.
- Before every commit: `git status`, no `.env`, no `.db`, no `.p7m`. Plain-text commits, no patch files.
- Work on `main`.

## Stack
- Hardhat 3, Solidity 0.8.28, viaIR true, optimizer 200 runs, evmVersion paris. ethers v6, erc725.js.
- LUKSO packages: use the single packages (`@lukso/lsp8-contracts`, `@lukso/lsp4-contracts`, ...),
  pinned; the umbrella `@lukso/lsp-smart-contracts` does not install.
- Backend: Node/Express, better-sqlite3, bind 127.0.0.1, PM2. No RPC from the browser: on-chain reads go
  through the backend, with an RPC key dedicated to this service. `eth_getLogs` always from `DEPLOY_BLOCK`.
- UP signatures: ERC-1271 with anti-replay (timestamp, 5-minute window).

## Privacy and wording
- No personal data on-chain or in logs. Store only what uniqueness needs, pseudonymised with a server-side secret.
- Never "official", "state recognised", CIE emblems or institutional logos.
- Owner UPs: testnet `0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C`, mainnet `0x4a2605796e0d91A9667d6E30365aEEC384C48c27`.

## Deployment
- Networks `luksoTestnet` (4201) and `luksoMainnet` (42); owner UPs in `contracts/scripts/networks.ts`.
- Deploy from GitHub Codespaces with `npm run deploy:<net>` then `npm run verify:<net>`; mainnet needs `CONFIRM_MAINNET=yes`.
- `contracts/deployments/<network>.json` is the source of truth for address and `DEPLOY_BLOCK`; commit it after deploying.
