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

## Tests

```bash
npm ci
npm test
```

Tests build a fake CIE-like PKI with the `openssl` CLI (root, sub CA, holder, OCSP responder): no real CIE and no
personal data. They also check that error messages never contain the fake tax code or names.
