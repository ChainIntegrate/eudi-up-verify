# UP CIE Link — backend

Node.js service that links a Universal Profile to a CIE: statements, UP signature (ERC-1271), CIE signature
verification, uniqueness, badge minting. Design: [`../docs/02-backend.md`](../docs/02-backend.md).

Running on testnet since 2026-10-15 (`docs/operations.md`). Contents:

- `src/cie/`: CIE signature verification
  - `verify.js`: CAdES from CieSign (`verifyCieCades`) and raw PKCS#1 signature from the Android app (`verifyCieRaw`);
    certificate checks (validity, key usage, CIE policy `1.3.76.47.4`), tax code from the commonName.
  - `chain.js`: explicit path validation with OpenSSL (`X509Certificate`): every link's signature is checked and
    the path must end on a pinned root. pkijs path building is deliberately not used (see the file header).
  - `ocsp.js`: OCSP by issuer + serial (also for the periodic recheck), response signature checked explicitly,
    freshness checks; network errors are `OCSP_UNAVAILABLE` (callers fail closed).
  - `trust.js`: trust store from a directory; only roots whose SHA-256 is pinned are anchors.
- `scripts/trust-extract.js`: extracts the CA certificates (never the holder's) from a CieSign `.p7m` into `trust/`.
- `src/app.js`, `src/server.js`: Express app bound to 127.0.0.1 (nginx in front), CORS limited to `PUBLIC_ORIGIN`,
  in-memory rate limits, stable error codes. Refuses to start if the port is busy, the RPC is unreachable or its
  chain id does not match `NETWORK`.
- `src/statements.js`: the statement text (ASCII, reproducible), modes `link` / `migrate` / `additional`,
  15-minute validity; the text is rebuilt from the row and checked by hash, never stored.
- `src/up.js`: LSP0 check and ERC-1271 `isValidSignature` on the UP (EIP-191 hash), through the backend RPC.
- `src/db.js`: SQLite schema (no personal data; persons only as HMAC of the tax code).
- `src/cieFlow.js`: CIE submission (CieSign `.p7m` or raw signature from the app), verified in the request; then a
  serial queue runs the uniqueness decision and the minting, so submissions never race.
- `src/linking.js`: uniqueness rules (one person, one primary UP): renewal, migration, exceptions with an opaque
  ticket approved on-chain by the owner, UP already linked to another person.
- `src/signer.js`: client of the signer process (`../signer`, audit UCL-08), which holds `ATTESTER_PRIVATE_KEY`,
  `UNIQ_PEPPER` and `CERT_REF_KEY`: person key = HMAC(UNIQ_PEPPER, tax code), certificate reference encrypted with
  AES-256-GCM, attester transactions signed (only `attest` / `invalidate` on the contract, rate-limited). The server
  refuses to start with those secrets in its own environment; it checks the signer at start-up (protocol, contract,
  attester, UNIQ_PEPPER check value stored at the first start) and refuses CIE files until the checks pass.
- `src/chain.js`: UpCieBadge reads and the attester's `attest` / `invalidate`, built and simulated here, signed by the
  signer, broadcast here.
- `src/indexer.js` (every minute): reads the contract events from `DEPLOY_BLOCK` (2 confirmations, bounded ranges)
  and applies renounce / revoke / reinstate to the local state; a mint not recorded locally is a problem.
- `src/revocation.js` (daily): OCSP recheck of every valid link; a revoked certificate invalidates the badge
  (`CERT_REVOKED`, through the same serial queue). OCSP unreachable never invalidates: after 3 consecutive days it
  is reported once. Cleanup of expired statements, stale exception requests and old notifications.
- `src/notify.js`: notifications go to an outbox table and are emailed by the server loop (retried on failure).
- `src/monitor.js` (separate process, hourly): backend health, indexer progress, RPC and chain id, attester
  (on-chain match and balance), backup age, CA certificate expiry, stuck emails, OCSP availability. Emails on
  change only (`[PROBLEM]`, `[OK]`), a `[REMINDER]` every 24 h while a problem lasts, a daily `[INFO]` summary.
- `scripts/backup.js` (daily): online SQLite copy, integrity check, gzip, age encryption to a public key,
  SHA-256 file, rotation (14 recent + 8 weekly), `last-backup.json` for the monitor. `scripts/restore.js` checks
  hash and integrity and never overwrites without `--force`.

## API (so far)

| Method | Path | |
|---|---|---|
| GET | `/api/health` | service status |
| GET | `/api/config` | chain id, contract, statement version, windows, accepted CIE channels |
| POST | `/api/statements` | `{up, mode}` → statement text to sign (the address must be an LSP0 UP) |
| GET | `/api/statements/:id` | status and text |
| GET | `/api/statements/:id/file` | the statement as a file to sign with CieSign (exact bytes) |
| POST | `/api/statements/:id/up-signature` | `{signature}` (EIP-191 by a UP controller), within 5 minutes, single use |
| POST | `/api/statements/:id/cie-cades` | CieSign `.p7m` as the raw body (only with `ALLOW_CADES_UPLOAD=true`) |
| POST | `/api/statements/:id/cie-raw` | `{certificate, signature}` base64, from the Android app |
| GET | `/api/badge/:up` | badge state read on-chain (`verified`, `verifiedPrimary`, status, dates), cached 10 s |
| | `/api/admin/*` | owner only (`src/admin.js`): `POST challenge`, `POST login` (ERC-1271, session cookie), `GET session`, `GET status`, `GET exceptions`, `POST exceptions/:ticket/reject`, `GET badge/:up`, `POST tx` (calldata for the owner UP), `POST log`, `POST logout` |

Statement statuses: `pending_up` → `pending_cie` → `verifying` → `queued` → `minting` → `done`, or `failed` with an
`errorCode` (and an `exceptionTicket` for `EXCEPTION_REQUIRED` / `EXCEPTION_PENDING`), or `expired`.

## Run

```bash
cp .env.example .env   # fill in NETWORK, RPC_URL, PORT, PUBLIC_ORIGIN, DB_PATH
node src/server.js
```

## Operations

```bash
npm run monitor -- --test-email   # check SMTP settings
npm run monitor -- --dry-run      # print findings and the daily summary, send nothing
npm run monitor                   # one monitor run (schedule hourly)
npm run backup                    # one encrypted backup (schedule daily)
npm run backup:keygen -- key.txt  # on YOUR machine (npm ci --ignore-scripts first): writes the private key file, prints the public key
npm run restore -- --file <backup.db.gz.age> --identity key.txt --out restored.db
```

Deployment files are in [`../deploy`](../deploy): `ecosystem.config.cjs` (PM2, backend, a single instance),
`systemd/up-cie-link-monitor.{service,timer}` (hourly monitor, independent of PM2),
`systemd/up-cie-link-backup.{service,timer}` (daily encrypted backup) and `nginx/up-cie-link.conf`
(template for `up-cie-link.chainintegrate.it`; replace the `CHANGE_ME` values).

Keep a copy of `UNIQ_PEPPER`, `CERT_REF_KEY`, `ATTESTER_PRIVATE_KEY` (on the server only in the signer's
`/etc/up-cie-link/signer.env`) and the age private key outside the server:
without them a backup cannot be used. Backups are on the same server for now; an external copy is required
before real use.

## Tests

```bash
npm ci
npm test
```

Integration tests start a local Hardhat node from `../contracts` (build it first): ERC-1271 on a real LSP0 UP,
the minter on a real `UpCieBadge`, and `server.e2e.test.js`, which runs the real server process through the whole
flow (UP signature, CieSign-like CAdES, HTTP OCSP responder, on-chain mint). `frontend.e2e.test.js` drives the
pages in Chromium (Playwright, when installed globally) with a stub of the UP Browser Extension; set
`SCREENSHOTS_DIR=<dir>` to save screenshots of the main steps.

Tests build a fake CIE-like PKI with the `openssl` CLI (root, sub CA, holder, OCSP responder): no real CIE and no
personal data. They also check that error messages never contain the fake tax code or names.
