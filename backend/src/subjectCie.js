// UCL-44: data requests proved with the CIE, for a person who has no valid UP left (a UP whose link has ended
// reaches only its own data on the page). The operator gives the person a text to sign with CieSign
// (requestText), receives the .p7m and runs scripts/data-subject.js with --p7m: the signature, the chain and the
// revocation are checked as for a link, and the person key of the signing card (from the signer, UCL-08) must be
// the one of the named UP. Only then the whole person is exported or erased.
import { getAddress, isAddress } from "ethers";
import { decodeBinary, parseAsn1, pkijs } from "./cie/pki.js";
import { verifyCieCades } from "./cie/verify.js";

const HEADER = "up-cie-link data request by CIE v1";
const MAX_AGE_DAYS = 30;

export class CieRequestError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** The exact text the person signs with CieSign (ASCII, LF, no trailing newline). */
export function requestText(upInput, action, date = new Date()) {
  if (!isAddress(upInput) || !["export", "erase"].includes(action)) throw new CieRequestError("BAD_REQUEST");
  const day = date.toISOString().slice(0, 10);
  return [
    HEADER,
    `Universal-Profile: ${getAddress(upInput)}`,
    `Request: ${action}`,
    `Date: ${day}`,
    action === "erase"
      ? "I ask to erase all the data kept about the holder of this CIE. / Chiedo di cancellare tutti i dati conservati sul titolare di questa CIE."
      : "I ask for a copy of all the data kept about the holder of this CIE. / Chiedo una copia di tutti i dati conservati sul titolare di questa CIE.",
  ].join("\n");
}

function attachedContent(der) {
  const signed = new pkijs.SignedData({ schema: new pkijs.ContentInfo({ schema: parseAsn1(der) }).content });
  const e = signed.encapContentInfo.eContent;
  if (!e) throw new CieRequestError("DETACHED_SIGNATURE");
  return e.idBlock.isConstructed
    ? Buffer.concat(e.valueBlock.value.map((b) => Buffer.from(b.valueBlock.valueHexView)))
    : Buffer.from(e.valueBlock.valueHexView);
}

/**
 * Checks a CIE-signed data request for `up`. Resolves to {action} when the card's holder is the person linked to
 * `up`; throws CieRequestError (BAD_TEXT, TOO_OLD, WRONG_UP, NOT_THE_SAME_PERSON, NO_DATA) or the CIE check's
 * own error code (CERT_REVOKED, CHAIN_INVALID, ...).
 * @param {{db, signer, trust, up: string, ocspTransport?, now?: Date}} ctx
 */
export async function verifyCieRequest(p7m, { db, signer, trust, up, ocspTransport, now = new Date() }) {
  let content;
  try {
    content = attachedContent(decodeBinary(p7m)).toString("ascii");
  } catch (e) {
    throw e instanceof CieRequestError ? e : new CieRequestError("BAD_TEXT");
  }
  const m = content.match(/^up-cie-link data request by CIE v1\nUniversal-Profile: (0x[0-9a-fA-F]{40})\nRequest: (export|erase)\nDate: (\d{4}-\d{2}-\d{2})\n/);
  if (!m) throw new CieRequestError("BAD_TEXT");
  const [, signedUp, action, day] = m;
  if (content !== requestText(signedUp, action, new Date(`${day}T00:00:00Z`))) throw new CieRequestError("BAD_TEXT");
  const ageDays = (now - Date.parse(`${day}T00:00:00Z`)) / 86_400_000;
  if (ageDays < -1 || ageDays > MAX_AGE_DAYS) throw new CieRequestError("TOO_OLD");
  if (getAddress(signedUp) !== getAddress(up)) throw new CieRequestError("WRONG_UP");
  const link = db.prepare("SELECT person_key FROM links WHERE up = ?").get(getAddress(up));
  if (!link) throw new CieRequestError("NO_DATA");
  const result = await verifyCieCades(p7m, Buffer.from(content, "ascii"), { trust, ocspTransport, now });
  const key = await signer.personKey(result.taxCode);
  result.taxCode = undefined;
  if (!key.equals(link.person_key)) throw new CieRequestError("NOT_THE_SAME_PERSON");
  return { action };
}
