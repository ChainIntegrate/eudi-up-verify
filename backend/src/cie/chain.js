// Explicit certificate path validation with Node's X509Certificate (OpenSSL).
//
// We do NOT use pkijs CertificateChainValidationEngine: in tests (2026-10-14) it accepted a path in which the
// holder certificate was not signed by the CA it was linked to (matching by name only). Here every link is
// checked: issuer name/key identifier, signature with the parent's public key, parent is a CA valid at `now`,
// and the path must end on a pinned, correctly self-signed root.
import { X509Certificate } from "node:crypto";
import { CieError, certDer, certSha256 } from "./pki.js";

const MAX_DEPTH = 4;

const x509 = (cert) => new X509Certificate(certDer(cert));
const validAt = (x, now) => new Date(x.validFrom) <= now && now <= new Date(x.validTo);

/**
 * @param leaf   pkijs Certificate (holder)
 * @param pool   pkijs Certificates: candidate intermediates (never trusted by themselves)
 * @param roots  pkijs Certificates: pinned roots (trust anchors)
 * @returns {{issuer: any, path: any[]}} issuer = direct issuer of the leaf (pkijs Certificate)
 */
export function validateChain(leaf, pool, roots, now = new Date()) {
  const pinned = new Map(roots.map((r) => [certSha256(r), r]));
  const candidates = [...pool, ...roots].map((c) => ({ pkijs: c, x: x509(c), fp: certSha256(c) }));

  const path = [leaf];
  let current = x509(leaf);
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const parent = candidates.find(
      (c) => c.x.ca && validAt(c.x, now) && current.checkIssued(c.x) && current.verify(c.x.publicKey),
    );
    if (!parent) throw new CieError("CHAIN_UNTRUSTED");
    path.push(parent.pkijs);
    if (pinned.has(parent.fp)) {
      // trust anchor reached: it must be a correctly self-signed root
      if (!(parent.x.checkIssued(parent.x) && parent.x.verify(parent.x.publicKey))) {
        throw new CieError("CHAIN_UNTRUSTED", "pinned root is not self-signed");
      }
      return { issuer: path[1], path };
    }
    if (parent.x.checkIssued(parent.x)) throw new CieError("CHAIN_UNTRUSTED", "path ends on an unpinned root");
    current = parent.x;
  }
  throw new CieError("CHAIN_UNTRUSTED", "path too long");
}
