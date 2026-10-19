// UpCieBadge client: reads (exceptionOf) and the attester's writes (attest, invalidate).
// Writes are only called from the serial queue, so the attester never has two transactions in flight.
import { Contract, Wallet, encodeBytes32String } from "ethers";

export const BADGE_ABI = [
  "function exceptionOf(bytes32 ticket) view returns (uint8)",
  "function isVerified(address up) view returns (bool)",
  "function isVerifiedPrimary(address up) view returns (bool)",
  "function attester() view returns (address)",
  "function owner() view returns (address)",
  "function getData(bytes32 dataKey) view returns (bytes)",
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
    attesterOf: (other) => new Contract(other, BADGE_ABI, provider).attester(), // UCL-38: superseded contracts
    owner: () => c.owner(),
    getData: (key) => c.getData(key),
    balance: (address) => provider.getBalance(address),
  };
}

export class MintError extends Error {
  constructor(code, txHash = null) {
    super(code);
    this.code = code;
    this.txHash = txHash;
  }
}

/**
 * Attester writes (UCL-01):
 *  - a plain Wallet: the nonce is read from the node for every transaction (the queue is serial), so a failure
 *    never leaves a local nonce gap;
 *  - every call is simulated first (staticCall): a revert becomes SIMULATION_REVERTED without sending anything;
 *  - the receipt is awaited with a timeout: TX_TIMEOUT carries the hash, the caller decides (the queue moves on).
 * `onSent(hash)` is called as soon as the transaction is broadcast, before waiting (UCL-04).
 * @param {{confirmations?: number, timeoutMs?: number}} [opts]
 */
export function createMinter(provider, address, attesterPrivateKey, { confirmations = 1, timeoutMs = 180_000 } = {}) {
  const signer = new Wallet(attesterPrivateKey, provider);
  const c = new Contract(address, BADGE_ABI, signer);
  const send = async (fn, args, onSent) => {
    try {
      await c[fn].staticCall(...args);
    } catch {
      throw new MintError("SIMULATION_REVERTED");
    }
    let tx;
    try {
      // nonce read directly from the node (ethers caches identical requests for a short time)
      const nonce = Number(await provider.send("eth_getTransactionCount", [signer.address, "pending"]));
      tx = await c[fn](...args, { nonce });
    } catch {
      throw new MintError("SEND_FAILED");
    }
    onSent?.(tx.hash);
    let receipt;
    try {
      receipt = await tx.wait(confirmations, timeoutMs);
    } catch (e) {
      throw new MintError(e?.code === "TIMEOUT" ? "TX_TIMEOUT" : "TX_FAILED", tx.hash);
    }
    if (!receipt || receipt.status !== 1) throw new MintError("TX_FAILED", tx.hash);
    return receipt.hash;
  };
  return {
    address: signer.address,
    attest: (up, expiresAtSec, primary, { onSent } = {}) => send("attest", [up, SOURCE_CIE, expiresAtSec, primary], onSent),
    invalidate: (up, reason, { onSent } = {}) => send("invalidate", [up, encodeBytes32String(reason)], onSent),
  };
}
