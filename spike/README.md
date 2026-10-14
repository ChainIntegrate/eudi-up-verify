# Spike: verify a CIE signature over a UP statement

Goal: check, on a **real** Italian CIE, the facts the whole project depends on:
signature format produced by CieSign, certificate chain up to the CA of the Ministero dell'Interno,
where the codice fiscale sits in the holder certificate, and revocation (OCSP/CRL).

This is throwaway code, not the production backend. It runs on Linux, macOS and **Windows**
(Node.js 20 or newer, nothing else). Only `selftest.sh` needs a Unix shell.

## Privacy

- `verify-cie.mjs` never prints personal values (names, codice fiscale, certificate serial):
  only attribute types, lengths, patterns and pass/fail results. It writes nothing to disk.
- The signed `.p7m` **does** contain your name and codice fiscale. Run the spike on your own machine,
  never commit the `.p7m` (it is git-ignored) and delete it when done.

## Steps

```bash
cd spike
npm ci

# 1. Create the statement (testnet owner UP as example)
node make-statement.mjs --up 0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C --out enunciato.txt

# 2. Sign enunciato.txt with the CIE, CAdES format (.p7m):
#    - phone: CieSign app -> Firma -> pick the file -> CAdES -> PIN -> hold the CIE on the phone
#    - PC:    "CIE ID" desktop software + USB NFC reader -> Firma elettronica -> CAdES
#    Do not open and re-save enunciato.txt with an editor: the bytes must stay identical.

# 3. Verify. Trust anchors come from the Italian eIDAS Trusted List (AgID);
#    --online also queries OCSP and downloads CRLs.
node verify-cie.mjs --p7m enunciato.txt.p7m --statement enunciato.txt \
  --tsl https://eidas.agid.gov.it/TL/TSL-IT.xml --online
```

On Windows PowerShell write the last command on one line (or use a backtick `` ` `` instead of `\`).

Paste the whole output back: it is safe to share.

## Checks performed

1. CMS structure: SignedData, attached or detached content, base64/PEM/DER input.
2. Signed content equals the statement byte for byte (reports BOM / CRLF differences).
3. CMS signature valid; signed attributes listed (CAdES `signingCertificateV2`).
4. Holder certificate: validity, issuer, key, masked subject attributes, codice fiscale location,
   key usage, policies, AIA and CRL distribution points.
5. Chain up to the trust anchors: `--ca` files and/or the IdV services of the Trusted List (`--tsl`).
   Spike limitation: the XML signature of the Trusted List is not verified.
6. Revocation via CRL (`--crl-file`, embedded, or downloaded with `--online`) and OCSP (`--online`).
   No revocation source = failure (fail closed, decision D5).

Exit code 0 = all checks passed, 1 = at least one failure.

## Self-test

`npm run selftest` builds a fake CA and a fake holder certificate with openssl, signs a statement,
and runs 12 positive/negative cases, including a fake Trusted List and local OCSP/CRL servers.
It also fails if any fake personal value appears in the output. Requires bash, `openssl`, `python3`
and GNU `date` (Linux, or WSL on Windows).
