// Verification of a CIE signature over a statement.
//
// Two channels:
//  - verifyCieCades: CAdES (.p7m) produced by CieSign / CIE ID (tests and demo, ALLOW_CADES_UPLOAD)
//  - verifyCieRaw:   RSA PKCS#1 v1.5 / SHA-256 signature + holder certificate sent by the Android app (NFC)
//
// Both end in verifyHolder: certificate checks, chain to a pinned root, OCSP (fail-closed), tax code extraction.
// The returned object contains the tax code (personal data): the caller must derive the uniqueness key
// and discard it. Nothing here logs or stores personal data.
import { X509Certificate, constants, verify as cryptoVerify } from "node:crypto";
import { validateChain } from "./chain.js";
import { ocspStatus } from "./ocsp.js";
import {
  CieError,
  certDer,
  certSha256,
  decodeBinary,
  hasKeyUsageDigitalSignature,
  isCa,
  isSelfIssued,
  ocspUrls,
  parseAsn1,
  parseCertificate,
  pkijs,
  policies,
  serialHex,
  toArrayBuffer,
} from "./pki.js";

// Italian tax code (codice fiscale), omocodia letters included.
const CF_RE = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;
// Certificate policy of the CIE holder authentication certificate (observed on a real CIE, spike 2026-10-14).
export const CIE_AUTH_POLICY = "1.3.76.47.4";

/**
 * @typedef {object} VerifyContext
 * @property {{roots: any[], intermediates: any[]}} trust   from loadTrustStore
 * @property {Date} [now]
 * @property {string|null} [requiredPolicy]  default CIE_AUTH_POLICY; null disables the check
 * @property {Function} [ocspTransport]       injectable for tests
 */

/** @returns {Promise<{taxCode: string, notAfter: Date, certRef: {serialHex: string, issuerSha256: string, ocspUrl: string}}>} */
export async function verifyCieCades(p7m, statement, ctx) {
  let signedData;
  try {
    const contentInfo = new pkijs.ContentInfo({ schema: parseAsn1(decodeBinary(p7m)) });
    if (contentInfo.contentType !== pkijs.ContentInfo.SIGNED_DATA) throw new Error("not SignedData");
    signedData = new pkijs.SignedData({ schema: contentInfo.content });
  } catch {
    throw new CieError("CMS_INVALID");
  }
  if (signedData.signerInfos.length !== 1) throw new CieError("CMS_INVALID", "expected exactly one signer");

  const eContent = signedData.encapContentInfo.eContent;
  let detached = true;
  if (eContent) {
    detached = false;
    const content = eContent.idBlock.isConstructed
      ? Buffer.concat(eContent.valueBlock.value.map((b) => Buffer.from(b.valueBlock.valueHexView)))
      : Buffer.from(eContent.valueBlock.valueHexView);
    if (!content.equals(statement)) throw new CieError("CONTENT_MISMATCH");
  }

  let signer;
  try {
    const result = await signedData.verify({
      signer: 0,
      data: detached ? toArrayBuffer(statement) : undefined,
      checkChain: false,
      extendedMode: true,
    });
    if (!result.signatureVerified) throw new Error("bad signature");
    signer = result.signerCertificate;
  } catch {
    throw new CieError("SIGNATURE_INVALID");
  }
  if (!signer) throw new CieError("SIGNATURE_INVALID", "signer certificate missing");

  const extra = (signedData.certificates ?? []).filter((c) => c instanceof pkijs.Certificate && c !== signer);
  return verifyHolder(signer, extra, ctx);
}

/** @param {Buffer} certificate DER/PEM/base64 holder certificate  @param {Buffer} signature raw RSA signature */
export async function verifyCieRaw(certificate, signature, statement, ctx) {
  const cert = parseCertificate(certificate);
  let ok = false;
  try {
    const key = new X509Certificate(certDer(cert)).publicKey;
    ok = cryptoVerify("sha256", statement, { key, padding: constants.RSA_PKCS1_PADDING }, signature);
  } catch {
    ok = false;
  }
  if (!ok) throw new CieError("SIGNATURE_INVALID");
  return verifyHolder(cert, [], ctx);
}

async function verifyHolder(leaf, extraCerts, ctx) {
  const now = ctx.now ?? new Date();
  const requiredPolicy = ctx.requiredPolicy === undefined ? CIE_AUTH_POLICY : ctx.requiredPolicy;

  if (isCa(leaf)) throw new CieError("CERT_NOT_HOLDER");
  const notBefore = leaf.notBefore.value;
  const notAfter = leaf.notAfter.value;
  if (now < notBefore || now > notAfter) throw new CieError("CERT_EXPIRED");
  if (!hasKeyUsageDigitalSignature(leaf)) throw new CieError("CERT_KEY_USAGE");
  if (requiredPolicy && !policies(leaf).includes(requiredPolicy)) throw new CieError("CERT_POLICY");

  // Chain: explicit validation (see chain.js). Only pinned roots are trust anchors; from the CMS we take
  // intermediate CAs only, never self-issued certificates.
  const pool = [...extraCerts.filter((c) => isCa(c) && !isSelfIssued(c)), ...ctx.trust.intermediates];
  const { issuer } = validateChain(leaf, pool, ctx.trust.roots, now);

  const taxCode = extractTaxCode(leaf);

  const url = ocspUrls(leaf)[0];
  const status = await ocspStatus({ issuer, serialHex: serialHex(leaf), url, transport: ctx.ocspTransport, now });
  if (status === "revoked") throw new CieError("CERT_REVOKED");
  if (status !== "good") throw new CieError("CERT_STATUS_UNKNOWN");

  return {
    taxCode,
    notAfter,
    certRef: { serialHex: serialHex(leaf), issuerSha256: certSha256(issuer), ocspUrl: url },
  };
}

/** The tax code is the first 16 characters of the holder certificate commonName (observed: "CF/<12 digits>"). */
function extractTaxCode(cert) {
  const cn = cert.subject.typesAndValues.find((tv) => tv.type === "2.5.4.3");
  const value = String(cn?.value?.valueBlock?.value ?? "").toUpperCase();
  const candidate = value.slice(0, 16);
  if (!CF_RE.test(candidate)) throw new CieError("TAX_CODE_NOT_FOUND");
  return candidate;
}
