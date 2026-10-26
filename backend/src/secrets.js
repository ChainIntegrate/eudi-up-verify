// Opaque identifiers. The secrets themselves (UNIQ_PEPPER, CERT_REF_KEY, attester key) live in the signer process
// (../../signer, audit UCL-08): the person key and the encrypted certificate reference are made there.
import { randomBytes } from "node:crypto";

/** Opaque exception ticket (bytes32), carries no personal data. */
export const newTicket = () => `0x${randomBytes(32).toString("hex")}`;
