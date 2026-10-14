// Low-level PKI helpers shared by the CIE verification modules (pkijs on Node's WebCrypto).
import { createHash, webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

pkijs.setEngine("node", new pkijs.CryptoEngine({ name: "node", crypto: webcrypto }));

export { asn1js, pkijs };

/** Error with a stable code. Messages never contain personal data. */
export class CieError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = "CieError";
    this.code = code;
  }
}

export const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
export const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

/** Accepts DER, PEM (any label) or bare base64 (CieSign may save .p7m as base64 text). */
export function decodeBinary(buf) {
  const text = buf.toString("latin1");
  if (text.includes("-----BEGIN")) {
    return Buffer.from(text.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.trim().startsWith("MI")) {
    return Buffer.from(text.replace(/\s+/g, ""), "base64");
  }
  return buf;
}

export function parseAsn1(buf) {
  const asn1 = asn1js.fromBER(toArrayBuffer(buf));
  if (asn1.offset === -1) throw new CieError("ASN1_INVALID");
  return asn1.result;
}

export function parseCertificate(buf) {
  try {
    return new pkijs.Certificate({ schema: parseAsn1(decodeBinary(buf)) });
  } catch {
    throw new CieError("CERT_INVALID");
  }
}

export const certDer = (cert) => Buffer.from(cert.toSchema(true).toBER(false));
export const certSha256 = (cert) => sha256Hex(certDer(cert));
export const isSelfIssued = (cert) => cert.subject.isEqual(cert.issuer);

export const certToPem = (cert) =>
  `-----BEGIN CERTIFICATE-----\n${certDer(cert).toString("base64").match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`;

const DN_NAMES = { "2.5.4.3": "CN", "2.5.4.6": "C", "2.5.4.10": "O", "2.5.4.11": "OU" };
/** Distinguished name as text. Use ONLY for CA names, never for the holder. */
export const dnString = (name) =>
  name.typesAndValues.map((tv) => `${DN_NAMES[tv.type] ?? tv.type}=${tv.value?.valueBlock?.value ?? ""}`).join(", ");

export const extension = (cert, oid) => (cert.extensions ?? []).find((e) => e.extnID === oid);

export function ocspUrls(cert) {
  const ext = extension(cert, "1.3.6.1.5.5.7.1.1");
  return (ext?.parsedValue?.accessDescriptions ?? [])
    .filter((d) => d.accessMethod === "1.3.6.1.5.5.7.48.1" && d.accessLocation?.type === 6)
    .map((d) => d.accessLocation.value);
}

export function hasKeyUsageDigitalSignature(cert) {
  const ku = extension(cert, "2.5.29.15");
  if (!ku) return false;
  const bits = new Uint8Array(ku.parsedValue.valueBlock.valueHexView);
  return (bits[0] & 0x80) !== 0;
}

export function policies(cert) {
  const ext = extension(cert, "2.5.29.32");
  return (ext?.parsedValue?.certificatePolicies ?? []).map((p) => p.policyIdentifier);
}

export function isCa(cert) {
  const bc = extension(cert, "2.5.29.19");
  return Boolean(bc?.parsedValue?.cA);
}

export const serialHex = (cert) => Buffer.from(cert.serialNumber.valueBlock.valueHexView).toString("hex");
