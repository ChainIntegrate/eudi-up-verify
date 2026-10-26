# UP CIE Link

Links a [LUKSO](https://lukso.network) Universal Profile (UP) to an Italian electronic identity card (CIE),
and marks the UP with a soulbound "verified" badge. **No name, tax code or card data goes on-chain.**

> Proof of concept by ChainIntegrate, under development. Not a government service and not an identity document:
> the badge only states that, at a given time, whoever controls the UP also held a valid CIE and its PIN.

## How it works

1. The backend prepares a short **statement** containing the UP address, a one-time nonce and an expiry.
2. The **UP signs** the statement (ERC-1271: the backend checks it with the UP's `isValidSignature`).
3. The **CIE signs the same statement** with the holder's key on the chip, unlocked by the card PIN
   (today with the CieSign app; next with an Android app reading the card over NFC, whose channel stays disabled
   until the app ships).
4. The backend verifies the CIE signature, the certificate chain up to the Ministero dell'Interno CA, and revocation
   (OCSP, fail-closed). It derives a pseudonymous uniqueness key from the tax code (HMAC with a server-side secret)
   and discards every personal value.
5. The attester mints a **soulbound LSP8 badge** on the UP: source, verification time, expiry (the first day of the
   month in which the card expires, so the exact date, which is the holder's birthday, is not published, and the
   badge never outlives the card) and status.
   Other contracts can call `isVerified(up)`, or `isVerifiedPrimary(up)` for strict "one person, one UP"
   (additional UPs are allowed only by exception). Note: the badge is tied to the UP, so whoever knows the UP's owner
   learns that they have a verified CIE; a migration between two UPs is visible on-chain as two close operations.

Both signatures cover the same bytes, so the link between the UP and the CIE is cryptographic, not just a session on
our server.

## Status

| Phase | Content | State |
|---|---|---|
| 0 | Analysis, options, decisions (`docs/00-analisi.md`) | done |
| Spike | Verify a real CIE signature (`spike/`) | done, all checks passed on a real CIE |
| 1 | Attester contract, tests, deployment (`contracts/`) | done; redeployed on testnet after the audit (`0x6A52…71BA`), verified, LSP4 metadata set |
| 2 | Backend (Node/Express): statements, ERC-1271, CIE verification, minting, jobs, monitor, backups | done |
| 3 | Frontend: connect UP, sign, show badge, self-service data export/erasure, admin page | done on testnet (live at up-cie-link.chainintegrate.it; first real UP + CIE link on 2026-10-15; renounce, data export and re-link after renouncing tested by the owner); UP Wallet for Android (WalletConnect) at mainnet |
| 4 | Android app (NFC signature), end-to-end demo | to do |
| Server | Testnet service on the VPS: PM2, monitor and backup timers, nginx + TLS (`docs/operations.md`) | done (2026-10-15), updated with all audit fixes on 2026-10-19 |
| Audit | Two security/privacy reviews (2026-10-14 and 2026-10-15) and their fixes (`docs/audit/`) | done: every finding fixed or decided; deferred by decision: separate signing/HMAC process (UCL-08), CIE certificate policy check (UCL-13), privacy notice completion (UCL-14), off-site backups (UCL-25) |
| EU eID | Same attestation with other European eID cards that carry a signing certificate | exploring: looking for testers |
| Mainnet | Contract on mainnet (possibly the same address on every network via the Nick factory; creator data LSP4Creators/LSP12IssuedAssets), WalletConnect, complete privacy notice, off-site backups (`docs/operations.md` §6) | to do |

## Repository layout

```
contracts/   Hardhat 3 project: UpCieBadge (LSP8 soulbound), tests, deploy/verify/metadata scripts, deployments/
backend/     Node/Express service: statements, UP and CIE verification, minting queue, indexer, monitor, backups
frontend/    Static pages (no third-party code): link, verify, my badge, privacy, legal notes
deploy/      PM2, systemd timers (monitor, backup), nginx site; server operations in docs/operations.md
spike/       Stand-alone scripts to create a statement and verify a CIE CAdES signature
docs/        Analysis, design notes and decisions (Italian); docs/audit: audit report and fix tracking
.devcontainer/  GitHub Codespaces setup (Node 22, dependencies, recommended secrets)
```

## Quick start

```bash
cd contracts && npm ci --ignore-scripts && npx hardhat test
cd ../backend && npm ci && npm test      # needs the contracts built; the browser test needs Playwright
```

Deployment (testnet first, then mainnet) is described in [`contracts/README.md`](contracts/README.md).
The CIE verification spike is described in [`spike/README.md`](spike/README.md).

## Privacy by design

- On-chain: only UP address, source, timestamps (expiry rounded to a month) and status. No name, no tax code, no hash
  of them. Invalidation reasons on-chain are generic.
- Off-chain: only an HMAC of the tax code (for "one person, one UP") and, for later revocation checks, the certificate
  serial and issuer, encrypted. Signed files and statements are not stored. Retention limits are implemented; holders
  export or erase their data themselves from the "My badge" page, signing the request with their UP (see the privacy
  notice in the frontend).
- Logs never contain certificates, tax codes or signatures. Adults only (age read from the tax code in memory).

## License

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 ChainIntegrate.
