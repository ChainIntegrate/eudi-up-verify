// OCSP status for a certificate identified by issuer + serial number.
// Works both at verification time (holder certificate in hand) and for the periodic recheck,
// where only the serial number, the issuer and the OCSP URL are stored (encrypted).
import { X509Certificate, createHash, randomBytes, verify as cryptoVerify } from "node:crypto";
import { CieError, asn1js, certDer, parseAsn1, pkijs } from "./pki.js";

const SHA1 = "1.3.14.3.2.26";
const sha1 = (bytes) => createHash("sha1").update(bytes).digest();

function certId(issuer, serialHexValue) {
  const issuerNameHash = sha1(Buffer.from(issuer.subject.toSchema().toBER(false)));
  const issuerKeyHash = sha1(Buffer.from(issuer.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView));
  return new pkijs.CertID({
    hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SHA1, algorithmParams: new asn1js.Null() }),
    issuerNameHash: new asn1js.OctetString({ valueHex: issuerNameHash }),
    issuerKeyHash: new asn1js.OctetString({ valueHex: issuerKeyHash }),
    serialNumber: new asn1js.Integer({ valueHex: Buffer.from(serialHexValue, "hex") }),
  });
}

// UCL-18: SHA-1 signatures are refused unless OCSP_ALLOW_SHA1=true (escape hatch until the real responder has
// been checked: see docs/audit, UCL-06).
const SIG_HASH = {
  ...(process.env.OCSP_ALLOW_SHA1 === "true" ? { "1.2.840.113549.1.1.5": "sha1" } : {}),
  "1.2.840.113549.1.1.11": "sha256",
  "1.2.840.113549.1.1.12": "sha384",
  "1.2.840.113549.1.1.13": "sha512",
  "1.2.840.10045.4.3.2": "sha256", // ecdsa-with-SHA256
  "1.2.840.10045.4.3.3": "sha384",
  "1.2.840.10045.4.3.4": "sha512",
};
const OCSP_SIGNING = "1.3.6.1.5.5.7.3.9";
const OCSP_NONCE = "1.3.6.1.5.5.7.48.1.2";

function verifyResponseSignature(basic, issuer, now) {
  const hash = SIG_HASH[basic.signatureAlgorithm.algorithmId];
  if (!hash) return false;
  const issuerX = new X509Certificate(certDer(issuer));
  const responders = [issuerX];
  for (const c of basic.certs ?? []) {
    try {
      const x = new X509Certificate(certDer(c));
      const validNow = new Date(x.validFrom) <= now && now <= new Date(x.validTo);
      const delegated = (x.keyUsage ?? []).includes(OCSP_SIGNING);
      if (validNow && delegated && x.checkIssued(issuerX) && x.verify(issuerX.publicKey)) responders.push(x);
    } catch {
      /* ignore unusable certificates */
    }
  }
  const data = Buffer.from(basic.tbsResponseData.tbsView);
  const signature = Buffer.from(basic.signature.valueBlock.valueHexView);
  return responders.some((r) => {
    try {
      return cryptoVerify(hash, data, r.publicKey, signature);
    } catch {
      return false;
    }
  });
}

const same = (a, b) => Buffer.from(a.valueBlock.valueHexView).equals(Buffer.from(b.valueBlock.valueHexView));

/** Default transport: HTTP POST with timeout. Injectable for tests. */
export async function httpOcsp(url, requestDer, timeoutMs = 10_000) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/ocsp-request", Accept: "application/ocsp-response" },
    body: requestDer,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * @returns {"good"|"revoked"|"unknown"}
 * @throws CieError OCSP_UNAVAILABLE (network/responder error) or OCSP_INVALID (bad signature, stale, mismatch)
 */
export async function ocspStatus({ issuer, serialHex, url, transport = httpOcsp, now = new Date(), maxAgeMs = 86400_000 }) {
  if (!url) throw new CieError("OCSP_UNAVAILABLE", "no OCSP URL");
  const id = certId(issuer, serialHex);
  const request = new pkijs.OCSPRequest();
  request.tbsRequest.requestList = [new pkijs.Request({ reqCert: id })];
  // UCL-18: a nonce; if the responder echoes it, it must match (many responders do not, then freshness applies)
  const nonce = randomBytes(16);
  request.tbsRequest.requestExtensions = [
    new pkijs.Extension({ extnID: OCSP_NONCE, extnValue: new asn1js.OctetString({ valueHex: nonce }).toBER(false) }),
  ];

  let responseDer;
  try {
    responseDer = await transport(url, Buffer.from(request.toSchema(true).toBER(false)));
  } catch {
    throw new CieError("OCSP_UNAVAILABLE");
  }

  let basic;
  try {
    const response = new pkijs.OCSPResponse({ schema: parseAsn1(responseDer) });
    if (response.responseStatus.valueBlock.valueDec !== 0) throw new CieError("OCSP_UNAVAILABLE", "responder error");
    basic = new pkijs.BasicOCSPResponse({
      schema: parseAsn1(Buffer.from(response.responseBytes.response.valueBlock.valueHexView)),
    });
  } catch (e) {
    if (e instanceof CieError) throw e;
    throw new CieError("OCSP_INVALID", "unparsable response");
  }

  // Signed by the issuer itself or by a delegated responder certificate issued by it (explicit check with
  // OpenSSL, not pkijs path building: see chain.js).
  if (!verifyResponseSignature(basic, issuer, now)) throw new CieError("OCSP_INVALID", "response signature");

  const single = basic.tbsResponseData.responses.find(
    (r) =>
      same(r.certID.issuerNameHash, id.issuerNameHash) &&
      same(r.certID.issuerKeyHash, id.issuerKeyHash) &&
      same(r.certID.serialNumber, id.serialNumber),
  );
  if (!single) throw new CieError("OCSP_INVALID", "response does not cover the certificate");

  const echoed = (basic.tbsResponseData.responseExtensions ?? []).find((e) => e.extnID === OCSP_NONCE);
  if (echoed) {
    let value;
    try {
      value = Buffer.from(parseAsn1(Buffer.from(echoed.extnValue.valueBlock.valueHexView)).valueBlock.valueHexView);
    } catch {
      value = Buffer.from(echoed.extnValue.valueBlock.valueHexView);
    }
    if (!value.equals(nonce)) throw new CieError("OCSP_INVALID", "nonce mismatch");
  }

  const thisUpdate = single.thisUpdate;
  if (thisUpdate > new Date(now.getTime() + 5 * 60_000) || now - thisUpdate > maxAgeMs) {
    throw new CieError("OCSP_INVALID", "stale response");
  }
  if (single.nextUpdate && single.nextUpdate < now) throw new CieError("OCSP_INVALID", "expired response");

  switch (single.certStatus.idBlock.tagNumber) {
    case 0:
      return "good";
    case 1:
      return "revoked";
    default:
      return "unknown";
  }
}
