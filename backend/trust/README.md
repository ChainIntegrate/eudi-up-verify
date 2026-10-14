# Trust store

CA certificates (PEM) for CIE verification: the "National root CA for the Italian Electronic Identity Card" and its
issuing sub CAs (SUBCA00x). They are public certificates. Populate with `npm run trust:extract -- <file.p7m>`.

Only roots whose SHA-256 fingerprint is listed in `CIE_ROOT_SHA256` are trust anchors. Before pinning, compare the
fingerprint with an independent source (AgID Trusted List, Ministero dell'Interno website).
