// UpCieBadge client: reads (exceptionOf) and the attester's writes (attest, invalidate).
// Writes are only called from the serial queue, so the attester never has two transactions in flight.
import { Contract, NonceManager, Wallet, encodeBytes32String } from "ethers";

export const BADGE_ABI = [
  "function exceptionOf(bytes32 ticket) view returns (uint8)",
  "function isVerified(address up) view returns (bool)",
  "function isVerifiedPrimary(address up) view returns (bool)",
  "function attester() view returns (address)",
  "function getAttestation(address up) view returns (tuple(bytes32 source, uint64 verifiedAt, uint64 expiresAt, uint8 status, bool primary))",
  "function attest(address up, bytes32 source, uint64 expiresAt, bool primary)",
  "function invalidate(address up, bytes32 reason)",
  "event Attested(address indexed up, bytes32 indexed tokenId, bytes32 source, uint64 verifiedAt, uint64 expiresAt, bool primary)",
  "event Invalidated(address indexed up, bytes32 indexed tokenId, bytes32 reason, address indexed by)",
  "event Revoked(address indexed up, bytes32 indexed tokenId, bytes32 reason)",
  "event Reinstated(address indexed up, bytes32 indexed tokenId)",
];

export const SOURCE_CIE = encodeBytes32String("CIE");

export function createBadgeReader(provider, address) {
  const c = new Contract(address, BADGE_ABI, provider);
  return {
    exceptionOf: (ticket) => c.exceptionOf(ticket),
    isVerified: (up) => c.isVerified(up),
    isVerifiedPrimary: (up) => c.isVerifiedPrimary(up),
    getAttestation: (up) => c.getAttestation(up),
    attester: () => c.attester(),
  };
}

/**
 * @param {{confirmations?: number}} [opts]
 * @returns {{address: string, attest: Function, invalidate: Function}}
 */
export function createMinter(provider, address, attesterPrivateKey, { confirmations = 1 } = {}) {
  const signer = new NonceManager(new Wallet(attesterPrivateKey, provider));
  const c = new Contract(address, BADGE_ABI, signer);
  const send = async (txPromise) => {
    const tx = await txPromise;
    const receipt = await tx.wait(confirmations);
    if (!receipt || receipt.status !== 1) throw Object.assign(new Error("transaction failed"), { code: "MINT_FAILED" });
    return receipt.hash;
  };
  return {
    address: new Wallet(attesterPrivateKey).address,
    attest: (up, expiresAtSec, primary) => send(c.attest(up, SOURCE_CIE, expiresAtSec, primary)),
    invalidate: (up, reason) => send(c.invalidate(up, encodeBytes32String(reason))),
  };
}
