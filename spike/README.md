# Spike: verify a CIE signature over a UP statement

Goal: check, on a **real** Italian CIE, the facts the whole project depends on:
signature format produced by CieSign, certificate chain up to the Ministero dell'Interno CA,
where the codice fiscale sits in the holder certificate, and revocation (OCSP/CRL).

This is throwaway code, not the production backend.

## Privacy

- `verify-cie.mjs` never prints personal values (names, codice fiscale, certificate serial):
  only attribute types, lengths, patterns and pass/fail results. It writes nothing to disk.
- The signed `.p7m` **does** contain your name and codice fiscale. Run the spike on your own machine
  or server, never commit the `.p7m` (it is git-ignored) and delete it when done.

## Steps

```bash
cd spike
npm ci

# 1. Create the statement (testnet owner UP as example)
node make-statement.mjs --up 0x83cBE526D949A3AaaB4EF9a03E48dd862e81472C --out enunciato.txt

# 2. Copy enunciato.txt to the phone and sign it with the CieSign app:
#    Firma -> choose the file -> CAdES -> PIN -> hold the CIE on the phone.
#    Copy the resulting enunciato.txt.p7m back next to the script.

# 3. Download the CIE CA certificates of the Ministero dell'Interno (official site)
#    and pass each one with --ca. Step 4 output also prints the AIA "caIssuers" URL.

# 4. Verify (with --online the script queries OCSP and downloads CRLs)
node verify-cie.mjs --p7m enunciato.txt.p7m --statement enunciato.txt --ca <ca-file> --online
```

Paste the whole output back: it is safe to share.

## Checks performed

1. CMS structure: SignedData, attached or detached content, base64/PEM/DER input.
2. Signed content equals the statement byte for byte (reports BOM / CRLF differences).
3. CMS signature valid; signed attributes listed (CAdES `signingCertificateV2`).
4. Holder certificate: validity, issuer, key, masked subject attributes, codice fiscale location,
   key usage, policies, AIA and CRL distribution points.
5. Chain up to the CA certificates given with `--ca`.
6. Revocation via CRL (`--crl-file`, embedded, or downloaded with `--online`) and OCSP (`--online`).
   No revocation source = failure (fail closed, decision D5).

## Self-test

`npm run selftest` builds a fake CA and a fake holder certificate with openssl, signs a statement,
and runs 10 positive/negative cases, including local OCSP and CRL servers. It also fails if any fake
personal value appears in the output. Requires `openssl`, `python3` and GNU `date`.
