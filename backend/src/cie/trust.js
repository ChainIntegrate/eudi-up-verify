// Trust store for CIE certificates: CA certificates as PEM/DER files in a directory.
// Only self-issued roots whose SHA-256 fingerprint is pinned in configuration are trust anchors;
// non-self-issued CA certificates are intermediates (they still have to chain to a pinned root).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { CieError, certSha256, isCa, isSelfIssued, parseCertificate } from "./pki.js";

const normalizeFp = (fp) => fp.replace(/[^0-9a-f]/gi, "").toLowerCase();

export function loadTrustStore(dir, pinnedRootSha256) {
  const pinned = new Set(pinnedRootSha256.map(normalizeFp));
  if (pinned.size === 0) throw new CieError("TRUST_CONFIG", "no pinned root fingerprints configured");

  const roots = [];
  const intermediates = [];
  const files = readdirSync(dir).filter((f) => /\.(pem|cer|crt|der)$/i.test(f));
  for (const f of files) {
    const cert = parseCertificate(readFileSync(path.join(dir, f)));
    if (!isCa(cert)) continue; // never trust leaf certificates found in the store
    if (isSelfIssued(cert)) {
      if (pinned.has(certSha256(cert))) roots.push(cert);
    } else {
      intermediates.push(cert);
    }
  }
  if (roots.length === 0) throw new CieError("TRUST_CONFIG", "no pinned root certificate found in the trust store");
  return { roots, intermediates };
}

/** Builds a trust store from certificates already in memory (tests). */
export function trustStoreFromCerts(certs, pinnedRootSha256) {
  const pinned = new Set(pinnedRootSha256.map(normalizeFp));
  return {
    roots: certs.filter((c) => isSelfIssued(c) && pinned.has(certSha256(c))),
    intermediates: certs.filter((c) => !isSelfIssued(c) && isCa(c)),
  };
}
