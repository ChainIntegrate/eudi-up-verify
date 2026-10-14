# UP CIE Link — backend

Node.js service that links a Universal Profile to a CIE: statements, UP signature (ERC-1271), CIE signature
verification, uniqueness, badge minting. Design: [`../docs/02-backend.md`](../docs/02-backend.md).

Work in progress (phase 2). Implemented so far:

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

## API (so far)

| Method | Path | |
|---|---|---|
| GET | `/api/health` | service status |
| GET | `/api/config` | chain id, contract, statement version, windows, accepted CIE channels |
| POST | `/api/statements` | `{up, mode}` → statement text to sign (the address must be an LSP0 UP) |
| GET | `/api/statements/:id` | status and text |
| POST | `/api/statements/:id/up-signature` | `{signature}` (EIP-191 by a UP controller), within 5 minutes, single use |

## Run

```bash
cp .env.example .env   # fill in NETWORK, RPC_URL, PORT, PUBLIC_ORIGIN, DB_PATH
node src/server.js
```

## Tests

```bash
npm ci
npm test
```

`test/erc1271.integration.test.js` starts a local Hardhat node from `../contracts` (build it first) and checks
ERC-1271 against a real LSP0 Universal Profile. Tests build a fake CIE-like PKI with the `openssl` CLI (root, sub CA, holder, OCSP responder): no real CIE and no
personal data. They also check that error messages never contain the fake tax code or names.
