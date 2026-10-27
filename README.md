# UP CIE Link

Links a [LUKSO](https://lukso.network) Universal Profile (UP) to an Italian electronic identity card (CIE),
and marks the UP with a soulbound "verified" badge. **No name, tax code or card data goes on-chain.**

> Experimental service by ChainIntegrate, live on LUKSO mainnet at
> [up-cie-link.chainintegrate.it](https://up-cie-link.chainintegrate.it). Not a government service and not an identity document:
> the badge only states that, at a given time, whoever controls the UP also held a valid CIE and its PIN.

## How it works

1. The backend prepares a short **statement** containing the UP address, a one-time nonce and an expiry.
2. The **UP signs** the statement (ERC-1271: the backend checks it with the UP's `isValidSignature`): with the UP
   Browser extension on a computer or, on a phone, with LUKSO's Universal Profiles app or UP Wallet for Android
   (WalletConnect).
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
| 1 | Attester contract, tests, deployment (`contracts/`) | done; **mainnet** `0xc945c5FABBc19dBd04f90a1a4878cfA0F78C5e38` (block 8661334, 2026-10-27), LSP4 metadata and creator data (LSP4Creators/LSP12IssuedAssets) set; Blockscout shows a partial match (same bytecode; the exact source is commit `8746055`), full verification to retry |
| 2 | Backend (Node/Express): statements, ERC-1271, CIE verification, minting, jobs, monitor, backups | done |
| 3 | Frontend: connect UP, sign, show badge, self-service data export/erasure, admin page | done; live on mainnet since 2026-10-27 (first mainnet badges: a primary UP and an additional UP by exception, from a phone). Wallets: UP Browser extension (computer), UP Wallet for Android (phone, or QR code from a computer; real tests on 2026-10-26, whole link done from the phone) and LUKSO's Universal Profiles app (phones only, opened by its own WalletConnect link; on 2026-10-27 pairing and UP signature on mainnet verified, the badge itself was not minted through it). Not on the admin page, which is desktop-only. User guide (`/guida`), link previews (Open Graph). Earlier on testnet: first real UP + CIE link on 2026-10-15; renounce, data export, re-link after renouncing and data erasure tested by the owner |
| 4 | Android app (NFC signature), end-to-end demo | to do |
| Server | Service on the VPS: PM2, separate signer, monitor and backup timers, nginx + TLS (`docs/operations.md`) | done (2026-10-15); switched to mainnet on 2026-10-27, testnet data deleted |
| Audit | Three security/privacy reviews (2026-10-14, 2026-10-15, 2026-10-27) and their fixes (`docs/audit/`) | done: every finding fixed or decided (third review: UCL-44 … UCL-54 handled on 2026-10-27); separate signer process (UCL-08) and complete privacy notice (UCL-14) done on 2026-10-27; CIE certificate policy checked (UCL-13, the service is a relying party as the policy describes it); off-site backups (UCL-25) deferred to a reasonable number of users |
| EU eID | Same attestation with other European eID cards that carry a signing certificate | exploring: looking for testers |
| Mainnet | Contract on mainnet with creator data, user guide, switch of the service (`docs/operations.md` §6) | done on 2026-10-27 (plain deployment, no Nick factory; same attester key); testnet retired, minting stopped there. Off-site backups (UCL-25) still deferred |

## Repository layout

```
contracts/   Hardhat 3 project: UpCieBadge (LSP8 soulbound), tests, deploy/verify/metadata scripts, deployments/
backend/     Node/Express service: statements, UP and CIE verification, minting queue, indexer, monitor, backups
signer/      Separate process holding the attester key and the server secrets (no network, local socket, rate limits)
frontend/    Static pages: link, verify, my badge, guide, privacy, legal notes (third-party code only for the phone
             wallets: WalletConnect client, vendored, loaded on demand)
deploy/      PM2, systemd timers (monitor, backup), nginx site; server operations in docs/operations.md
spike/       Stand-alone scripts to create a statement and verify a CIE CAdES signature
docs/        Analysis, design notes and decisions (Italian); docs/audit: audit report and fix tracking
.devcontainer/  GitHub Codespaces setup (Node 22, dependencies, recommended secrets)
```

## Quick start

```bash
cd contracts && npm ci --ignore-scripts && npx hardhat test
cd ../signer && npm ci --ignore-scripts
cd ../backend && npm ci && npm test      # needs the contracts built; the browser test needs Playwright
```

Deployment and verification are described in [`contracts/README.md`](contracts/README.md); the mainnet switch of the
service in [`docs/operations.md`](docs/operations.md) §6.
The CIE verification spike is described in [`spike/README.md`](spike/README.md).

## Privacy by design

- On-chain: only UP address, source, timestamps (expiry rounded to a month) and status. No name, no tax code, no hash
  of them. Invalidation reasons on-chain are generic.
- Off-chain: only an HMAC of the tax code (for "one person, one UP") and, for later revocation checks, the certificate
  serial and issuer, encrypted. Signed files and statements are not stored. Retention limits are implemented; holders
  export or erase their data themselves from the "My badge" page, signing the request with their UP (see the privacy
  notice in the frontend).
- Logs never contain certificates, tax codes or signatures. Adults only (age read from the tax code in memory).
- The attester key and the server secrets are not in the web backend: a separate signer process (own user, no
  network, root-owned code) holds them, signs only the badge contract's `attest`/`invalidate` and rate-limits mints
  and tax-code fingerprints, so a compromised backend cannot copy them.

## License

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). Copyright 2026 ChainIntegrate.
