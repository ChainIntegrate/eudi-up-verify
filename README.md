# UP CIE Link

Links a [LUKSO](https://lukso.network) Universal Profile (UP) to an Italian electronic identity card (CIE),
and marks the UP with a soulbound "verified" badge. **No personal data goes on-chain.**

> Proof of concept by ChainIntegrate, under development. Not a government service and not an identity document:
> the badge only states that, at a given time, whoever controls the UP also held a valid CIE and its PIN.

## How it works

1. The backend prepares a short **statement** containing the UP address, a one-time nonce and an expiry.
2. The **UP signs** the statement (ERC-1271: the backend checks it with the UP's `isValidSignature`).
3. The **CIE signs the same statement** with the holder's key on the chip, unlocked by the card PIN
   (today with the CieSign app; next with an Android app reading the card over NFC).
4. The backend verifies the CIE signature, the certificate chain up to the Ministero dell'Interno CA, and revocation
   (OCSP, fail-closed). It derives a pseudonymous uniqueness key from the tax code (HMAC with a server-side secret)
   and discards every personal value.
5. The attester mints a **soulbound LSP8 badge** on the UP: source, verification time, expiry (the card's expiry)
   and status. Other contracts can call `isVerified(up)`, or `isVerifiedPrimary(up)` for strict
   "one person, one UP" (a person's additional UPs, allowed only by exception, are never linked on-chain).

Both signatures cover the same bytes, so the link between the UP and the CIE is cryptographic, not just a session on
our server.

## Status

| Phase | Content | State |
|---|---|---|
| 0 | Analysis, options, decisions (`docs/00-analisi.md`) | done |
| Spike | Verify a real CIE signature (`spike/`) | done, all checks passed on a real CIE |
| 1 | Attester contract, tests, deployment (`contracts/`) | done on testnet; redeploy needed for the primary flag |
| 2 | Backend (Node/Express): statements, ERC-1271, CIE verification, minting | to do |
| 3 | Frontend: connect UP, sign, show badge | to do |
| 4 | Android app (NFC signature), end-to-end demo | to do |

## Repository layout

```
contracts/   Hardhat 3 project: UpCieBadge (LSP8 soulbound), tests, deploy/verify scripts, deployments/
spike/       Stand-alone scripts to create a statement and verify a CIE CAdES signature
docs/        Analysis and design notes (Italian)
.devcontainer/  GitHub Codespaces setup (Node 22, dependencies, recommended secrets)
```

## Quick start

```bash
cd contracts
npm ci
npx hardhat test
```

Deployment (testnet first, then mainnet) is described in [`contracts/README.md`](contracts/README.md).
The CIE verification spike is described in [`spike/README.md`](spike/README.md).

## Privacy by design

- On-chain: only UP address, source, timestamps and status. No name, no tax code, no hash of them.
- Off-chain: only an HMAC of the tax code (for "one person, one UP") and, for later revocation checks, the certificate
  serial and issuer, encrypted. Signed files and statements are not stored.
- Logs never contain certificates, tax codes or signatures.

## License

Apache-2.0, see [LICENSE](LICENSE).
