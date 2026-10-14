// Spike: verify a CAdES (.p7m) signature made with an Italian CIE (e.g. via the CieSign app)
// over a statement produced by make-statement.mjs.
//
// Privacy: this script NEVER prints personal values from the certificate (names, tax code,
// serial number). It prints attribute types, lengths, patterns and pass/fail results only.
// It writes nothing to disk.
//
// Usage:
//   node verify-cie.mjs --p7m firmato.p7m --statement enunciato.txt
//        [--ca ca1.pem --ca ca2.cer ...]   trusted CA certificates (PEM or DER)
//        [--crl-file list.crl ...]         local CRLs (PEM or DER)
//        [--online]                        allow network: AIA issuer download, OCSP, CRL download
//
// Exit code: 0 if every mandatory check passed, 1 otherwise, 2 on usage errors.

import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import { parseArgs } from "node:util";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

pkijs.setEngine("node", new pkijs.CryptoEngine({ name: "node", crypto: webcrypto }));

const { values: args } = parseArgs({
  options: {
    p7m: { type: "string" },
    statement: { type: "string" },
    ca: { type: "string", multiple: true, default: [] },
    "crl-file": { type: "string", multiple: true, default: [] },
    online: { type: "boolean", default: false },
  },
});
if (!args.p7m) {
  console.error("Usage: node verify-cie.mjs --p7m <file> --statement <file> [--ca <file>...] [--crl-file <file>...] [--online]");
  process.exit(2);
}

// ---------- output helpers ----------
let failures = 0;
const ok = (m) => console.log(`[OK]   ${m}`);
const fail = (m) => { failures++; console.log(`[FAIL] ${m}`); };
const warn = (m) => console.log(`[WARN] ${m}`);
const info = (m) => console.log(`[INFO] ${m}`);
const section = (m) => console.log(`\n== ${m}`);

// ---------- decoding helpers ----------
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const toAB = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// Accepts DER, PEM (any label) or bare base64 (some tools save .p7m as base64 text).
function decodeBinary(buf) {
  const text = buf.toString("latin1");
  if (text.includes("-----BEGIN")) {
    const b64 = text.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");
    return Buffer.from(b64, "base64");
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(text) && text.trim().startsWith("MI")) {
    return Buffer.from(text.replace(/\s+/g, ""), "base64");
  }
  return buf;
}
function parseAsn1(buf, what) {
  const asn1 = asn1js.fromBER(toAB(buf));
  if (asn1.offset === -1) throw new Error(`cannot parse ${what} as ASN.1`);
  return asn1.result;
}
const loadCert = (path) => new pkijs.Certificate({ schema: parseAsn1(decodeBinary(readFileSync(path)), path) });
const loadCrlDer = (buf, what) => new pkijs.CertificateRevocationList({ schema: parseAsn1(decodeBinary(buf), what) });

const OID_NAMES = {
  "2.5.4.3": "commonName", "2.5.4.4": "surname", "2.5.4.42": "givenName", "2.5.4.5": "serialNumber",
  "2.5.4.6": "countryName", "2.5.4.7": "localityName", "2.5.4.8": "stateOrProvinceName",
  "2.5.4.10": "organizationName", "2.5.4.11": "organizationalUnitName", "2.5.4.12": "title",
  "2.5.4.46": "dnQualifier", "2.5.4.65": "pseudonym", "2.5.4.97": "organizationIdentifier",
  "1.2.840.113549.1.9.1": "emailAddress",
};
const oidName = (oid) => OID_NAMES[oid] ? `${OID_NAMES[oid]} (${oid})` : oid;
const attrValue = (tv) => String(tv.value?.valueBlock?.value ?? "");
// Full DN, used only for CA (issuer) names, never for the holder.
const dnString = (name) => name.typesAndValues.map((tv) => `${OID_NAMES[tv.type] ?? tv.type}=${attrValue(tv)}`).join(", ");
const sameName = (a, b) => a.isEqual(b);

// Italian tax code (codice fiscale), with omocodia letters.
const CF_RE = /[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]/;

// Describes a personal value without revealing it.
function describe(value) {
  const m = CF_RE.exec(value.toUpperCase());
  if (m) {
    const prefix = value.slice(0, m.index);
    const shownPrefix = /^[A-Z]{2,8}[-:/ ]?$/.test(prefix) ? `"${prefix}"` : `${prefix.length} chars`;
    const suffix = value.length - m.index - 16;
    return `length ${value.length}, CONTAINS CODICE FISCALE PATTERN (prefix: ${m.index ? shownPrefix : "none"}, suffix: ${suffix} chars)`;
  }
  const cls = /^[0-9]+$/.test(value) ? "digits" : /^[A-Za-z' -]+$/.test(value) ? "letters" : "mixed";
  return `length ${value.length}, ${cls}`;
}

function extension(cert, oid) {
  return (cert.extensions ?? []).find((e) => e.extnID === oid);
}
function generalNameUris(names) {
  return (names ?? []).filter((n) => n.type === 6).map((n) => n.value);
}
function aiaUrls(cert) {
  const ext = extension(cert, "1.3.6.1.5.5.7.1.1");
  const out = { ocsp: [], caIssuers: [] };
  for (const d of ext?.parsedValue?.accessDescriptions ?? []) {
    if (d.accessLocation?.type !== 6) continue;
    if (d.accessMethod === "1.3.6.1.5.5.7.48.1") out.ocsp.push(d.accessLocation.value);
    if (d.accessMethod === "1.3.6.1.5.5.7.48.2") out.caIssuers.push(d.accessLocation.value);
  }
  return out;
}
function crlUrls(cert) {
  const ext = extension(cert, "2.5.29.31");
  const urls = [];
  for (const dp of ext?.parsedValue?.distributionPoints ?? []) {
    if (Array.isArray(dp.distributionPoint)) urls.push(...generalNameUris(dp.distributionPoint));
  }
  return urls;
}

async function fetchBinary(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------- 1. CMS structure ----------
section("1. CMS / CAdES structure");
const p7m = decodeBinary(readFileSync(args.p7m));
const contentInfo = new pkijs.ContentInfo({ schema: parseAsn1(p7m, "p7m") });
if (contentInfo.contentType !== pkijs.ContentInfo.SIGNED_DATA) {
  fail(`not a SignedData (contentType ${contentInfo.contentType})`);
  process.exit(1);
}
const signedData = new pkijs.SignedData({ schema: contentInfo.content });
info(`SignedData version ${signedData.version}, signers: ${signedData.signerInfos.length}, embedded certificates: ${signedData.certificates?.length ?? 0}, embedded CRLs: ${signedData.crls?.length ?? 0}`);
if (signedData.signerInfos.length !== 1) warn("expected exactly one signer");

// Encapsulated content (attached) or detached.
let content = null;
const eContent = signedData.encapContentInfo.eContent;
if (eContent) {
  if (eContent.idBlock.isConstructed) {
    content = Buffer.concat(eContent.valueBlock.value.map((b) => Buffer.from(b.valueBlock.valueHexView)));
  } else {
    content = Buffer.from(eContent.valueBlock.valueHexView);
  }
  info(`content is ATTACHED (${content.length} bytes), eContentType ${signedData.encapContentInfo.eContentType}`);
} else {
  info("content is DETACHED: the statement file will be used as signed data");
}

// ---------- 2. Statement match ----------
section("2. Signed content vs statement");
let statement = null;
if (args.statement) statement = readFileSync(args.statement);
if (content && statement) {
  if (content.equals(statement)) {
    ok(`signed content matches the statement byte for byte (sha256 ${sha256(content)})`);
  } else {
    fail(`signed content differs from the statement (signed ${content.length} bytes sha256 ${sha256(content)}, statement ${statement.length} bytes sha256 ${sha256(statement)})`);
    if (content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) info("signed content starts with a UTF-8 BOM");
    if (content.includes("\r\n")) info("signed content uses CRLF line endings");
    const norm = (b) => b.toString("utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
    if (norm(content) === norm(statement)) info("they match after removing BOM / CRLF / trailing newlines");
  }
} else if (!content && !statement) {
  fail("detached signature and no --statement given: nothing to verify against");
} else if (!statement) {
  warn("no --statement given: content not compared");
}
const signedBytes = content ?? statement;

// ---------- 3. Signature ----------
section("3. Signature");
const signer = signedData.signerInfos[0];
info(`digest algorithm ${signer.digestAlgorithm.algorithmId}, signature algorithm ${signer.signatureAlgorithm.algorithmId}`);
const signedAttrs = signer.signedAttrs?.attributes ?? [];
const attrTypes = signedAttrs.map((a) => a.type);
const ATTRS = {
  "1.2.840.113549.1.9.3": "contentType", "1.2.840.113549.1.9.4": "messageDigest", "1.2.840.113549.1.9.5": "signingTime",
  "1.2.840.113549.1.9.16.2.47": "signingCertificateV2 (CAdES)", "1.2.840.113549.1.9.16.2.12": "signingCertificate (v1)",
};
info(`signed attributes: ${attrTypes.map((t) => ATTRS[t] ?? t).join(", ") || "none"}`);
if (!attrTypes.includes("1.2.840.113549.1.9.16.2.47") && !attrTypes.includes("1.2.840.113549.1.9.16.2.12")) {
  warn("no signingCertificate attribute: not a CAdES-BES signature");
}
const signingTime = signedAttrs.find((a) => a.type === "1.2.840.113549.1.9.5");
if (signingTime) info(`signingTime ${signingTime.values[0]?.toDate?.().toISOString?.() ?? "(unparsed)"}`);

let signerCert = null;
try {
  const result = await signedData.verify({
    signer: 0,
    data: content ? undefined : (signedBytes ? toAB(signedBytes) : undefined),
    checkChain: false,
    extendedMode: true,
  });
  signerCert = result.signerCertificate ?? null;
  if (result.signatureVerified) ok("CMS signature is valid for the signed content");
  else fail(`CMS signature NOT valid: ${result.message}`);
} catch (e) {
  signerCert = e.signerCertificate ?? null;
  fail(`CMS signature verification error: ${e.message ?? e}`);
}
if (!signerCert) {
  fail("signer certificate not found in the CMS");
  console.log(`\nResult: ${failures} failure(s)`);
  process.exit(1);
}

// ---------- 4. Holder certificate (masked) ----------
section("4. Holder certificate (values masked)");
const now = new Date();
const notBefore = signerCert.notBefore.value;
const notAfter = signerCert.notAfter.value;
if (notBefore <= now && now <= notAfter) ok(`certificate currently valid, expires in ${Math.floor((notAfter - now) / 86400000)} days`);
else fail("certificate NOT currently valid (expired or not yet valid)");
info(`issuer: ${dnString(signerCert.issuer)}`);
info(`public key: ${signerCert.subjectPublicKeyInfo.algorithm.algorithmId}, signature algorithm: ${signerCert.signatureAlgorithm.algorithmId}`);
const rsaKey = signerCert.subjectPublicKeyInfo.parsedKey;
if (rsaKey?.modulus) info(`RSA modulus ${rsaKey.modulus.valueBlock.valueHexView.length * 8 - (rsaKey.modulus.valueBlock.valueHexView[0] === 0 ? 8 : 0)} bits`);

let cfFound = [];
for (const tv of signerCert.subject.typesAndValues) {
  const d = describe(attrValue(tv));
  info(`subject ${oidName(tv.type)}: ${d}`);
  if (d.includes("CODICE FISCALE")) cfFound.push(`subject ${OID_NAMES[tv.type] ?? tv.type}`);
}
const san = extension(signerCert, "2.5.29.17");
for (const n of san?.parsedValue?.altNames ?? []) {
  const v = typeof n.value === "string" ? n.value : "";
  const d = v ? describe(v) : "(non-string)";
  info(`subjectAltName type ${n.type}: ${d}`);
  if (d.includes("CODICE FISCALE")) cfFound.push(`subjectAltName type ${n.type}`);
}
if (cfFound.length) ok(`codice fiscale pattern found in: ${cfFound.join("; ")}`);
else fail("codice fiscale pattern NOT found in subject or subjectAltName");

const ku = extension(signerCert, "2.5.29.15");
if (ku) {
  const bits = new Uint8Array(ku.parsedValue.valueBlock.valueHexView);
  const names = ["digitalSignature", "nonRepudiation", "keyEncipherment", "dataEncipherment", "keyAgreement", "keyCertSign", "cRLSign"];
  info(`keyUsage: ${names.filter((_, i) => bits[0] & (0x80 >> i)).join(", ")}`);
}
const eku = extension(signerCert, "2.5.29.37");
if (eku) info(`extKeyUsage: ${eku.parsedValue.keyPurposes.join(", ")}`);
const pol = extension(signerCert, "2.5.29.32");
if (pol) info(`certificatePolicies: ${pol.parsedValue.certificatePolicies.map((p) => p.policyIdentifier).join(", ")}`);
const aia = aiaUrls(signerCert);
info(`AIA OCSP: ${aia.ocsp.join(", ") || "none"}`);
info(`AIA caIssuers: ${aia.caIssuers.join(", ") || "none"}`);
const crlDps = crlUrls(signerCert);
info(`CRL distribution points: ${crlDps.join(", ") || "none"}`);

// ---------- 5. Chain ----------
section("5. Certificate chain");
const embedded = (signedData.certificates ?? []).filter((c) => c instanceof pkijs.Certificate);
for (const c of embedded) {
  if (c === signerCert || c.serialNumber.isEqual(signerCert.serialNumber) && sameName(c.issuer, signerCert.issuer)) continue;
  info(`embedded CA certificate: subject "${dnString(c.subject)}", issuer "${dnString(c.issuer)}"`);
}
const trusted = args.ca.map(loadCert);
for (const c of trusted) info(`trusted CA (--ca): "${dnString(c.subject)}", valid until ${c.notAfter.value.toISOString().slice(0, 10)}`);

let issuerCert = [...embedded, ...trusted].find((c) => sameName(c.subject, signerCert.issuer) && c !== signerCert) ?? null;
if (!issuerCert && args.online && aia.caIssuers.length) {
  try {
    const der = await fetchBinary(aia.caIssuers[0]);
    issuerCert = new pkijs.Certificate({ schema: parseAsn1(decodeBinary(der), "AIA issuer") });
    info(`issuer certificate downloaded from AIA: "${dnString(issuerCert.subject)}" (sha256 ${sha256(der)})`);
  } catch (e) {
    warn(`AIA issuer download failed: ${e.message}`);
  }
}

if (!trusted.length) {
  warn("no --ca given: chain NOT validated. Download the Ministero dell'Interno CA certificates and pass them with --ca");
  failures++;
} else {
  const engine = new pkijs.CertificateChainValidationEngine({
    trustedCerts: trusted,
    certs: [signerCert, ...embedded.filter((c) => c !== signerCert), ...(issuerCert && !embedded.includes(issuerCert) && !trusted.includes(issuerCert) ? [issuerCert] : [])],
    checkDate: now,
  });
  const r = await engine.verify();
  if (r.result) ok(`chain valid up to a trusted CA (${r.certificatePath?.length ?? "?"} certificates)`);
  else fail(`chain NOT valid: ${r.resultMessage}`);
}

// ---------- 6. Revocation ----------
section("6. Revocation");
let revocationChecked = false;
const crls = [];
for (const path of args["crl-file"]) crls.push({ crl: loadCrlDer(readFileSync(path), path), src: path });
for (const crl of signedData.crls ?? []) if (crl instanceof pkijs.CertificateRevocationList) crls.push({ crl, src: "embedded in CMS" });
if (args.online) {
  for (const url of crlDps) {
    try {
      crls.push({ crl: loadCrlDer(await fetchBinary(url), url), src: url });
    } catch (e) {
      warn(`CRL download failed (${url}): ${e.message}`);
    }
  }
}
for (const { crl, src } of crls) {
  if (!sameName(crl.issuer, signerCert.issuer)) { info(`CRL from ${src} is for another issuer, skipped`); continue; }
  if (!issuerCert) { warn(`CRL from ${src}: issuer certificate unknown, cannot verify CRL signature`); continue; }
  const sigOk = await crl.verify({ issuerCertificate: issuerCert });
  if (!sigOk) { fail(`CRL from ${src}: signature NOT valid`); continue; }
  const next = crl.nextUpdate?.value;
  if (next && next < now) warn(`CRL from ${src} is stale (nextUpdate ${next.toISOString()})`);
  revocationChecked = true;
  if (crl.isCertificateRevoked(signerCert)) fail(`certificate REVOKED according to CRL (${src})`);
  else ok(`certificate not in CRL (${src}, ${crl.revokedCertificates?.length ?? 0} entries)`);
}

if (args.online && aia.ocsp.length) {
  if (!issuerCert) {
    warn("OCSP: issuer certificate unknown, cannot build the request");
  } else {
    try {
      const req = new pkijs.OCSPRequest();
      await req.createForCertificate(signerCert, { hashAlgorithm: "SHA-1", issuerCertificate: issuerCert });
      const body = Buffer.from(req.toSchema(true).toBER(false));
      const respDer = await fetchBinary(aia.ocsp[0], { method: "POST", headers: { "Content-Type": "application/ocsp-request" }, body });
      const resp = new pkijs.OCSPResponse({ schema: parseAsn1(respDer, "OCSP response") });
      const respStatus = resp.responseStatus.valueBlock.valueDec;
      if (respStatus !== 0) {
        fail(`OCSP responder error, responseStatus ${respStatus}`);
      } else {
        const basic = new pkijs.BasicOCSPResponse({ schema: parseAsn1(Buffer.from(resp.responseBytes.response.valueBlock.valueHexView), "BasicOCSPResponse") });
        let sigOk = false;
        try { sigOk = await basic.verify({ trustedCerts: [issuerCert, ...trusted] }); } catch (e) { info(`OCSP signature check error: ${e.message ?? e}`); }
        if (sigOk) ok("OCSP response signature valid"); else fail("OCSP response signature NOT valid");
        const st = await resp.getCertificateStatus(signerCert, issuerCert);
        revocationChecked = true;
        if (!st.isForCertificate) fail("OCSP response does not cover this certificate");
        else if (st.status === 0) ok(`OCSP status GOOD (${aia.ocsp[0]})`);
        else if (st.status === 1) fail("OCSP status REVOKED");
        else fail("OCSP status UNKNOWN");
      }
    } catch (e) {
      warn(`OCSP query failed: ${e.message}`);
    }
  }
}
if (!revocationChecked) fail(`revocation NOT checked${args.online ? "" : " (use --online or --crl-file)"} (policy D5: fail closed)`);

// ---------- summary ----------
console.log(`\nResult: ${failures === 0 ? "ALL CHECKS PASSED" : `${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
