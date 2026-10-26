// UpCieBadge client: reads (exceptionOf) and the attester's writes (attest, invalidate).
// Writes are only called from the serial queue, so the attester never has two transactions in flight.
import { Contract, Interface, encodeBytes32String } from "ethers";

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
 * Attester writes (UCL-01, UCL-08):
 *  - the transaction is built here and signed by the signer process, which holds the key (UCL-08): it signs only
 *    attest()/invalidate() on this contract and applies its own rate limits;
 *  - the nonce is read from the node for every transaction (the queue is serial), so a failure never leaves a
 *    local nonce gap;
 *  - every call is simulated first (staticCall): a revert becomes SIMULATION_REVERTED without sending anything;
 *  - the receipt is awaited with a timeout: TX_TIMEOUT carries the hash, the caller decides (the queue moves on).
 * `onSent(hash)` is called as soon as the transaction is broadcast, before waiting (UCL-04).
 * Signer refusals: MINT_RATE_LIMITED (its rate limit), SIGNER_REFUSED, SIGNER_UNAVAILABLE; nothing was sent.
 * @param signer {{signTx(tx): Promise<string>}} (signer.js)
 * @param {() => string|null} attesterAddress the signer's address (from its hello; null while it is not ready)
 * @param {{confirmations?: number, timeoutMs?: number}} [opts]
 */
export function createMinter(provider, address, signer, attesterAddress, { confirmations = 1, timeoutMs = 180_000 } = {}) {
  const c = new Contract(address, BADGE_ABI, provider);
  const iface = new Interface(BADGE_ABI);
  const send = async (fn, args, onSent) => {
    const from = attesterAddress();
    if (!from) throw new MintError("SIGNER_UNAVAILABLE");
    try {
      await c[fn].staticCall(...args, { from });
    } catch {
      throw new MintError("SIMULATION_REVERTED");
    }
    const data = iface.encodeFunctionData(fn, args);
    let raw;
    try {
      const [nonceHex, gas, fees, network] = await Promise.all([
        // nonce read directly from the node (ethers caches identical requests for a short time)
        provider.send("eth_getTransactionCount", [from, "pending"]),
        provider.estimateGas({ from, to: address, data }),
        provider.getFeeData(),
        provider.getNetwork(),
      ]);
      const tx = {
        to: address,
        data,
        value: "0",
        chainId: Number(network.chainId),
        nonce: Number(nonceHex),
        gasLimit: ((gas * 12n) / 10n).toString(), // 20% margin
        maxFeePerGas: fees.maxFeePerGas.toString(),
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas.toString(),
      };
      raw = await signer.signTx(tx);
    } catch (e) {
      if (e?.code === "RATE_LIMITED") throw new MintError("MINT_RATE_LIMITED");
      if (e?.code === "TX_REFUSED") throw new MintError("SIGNER_REFUSED");
      if (e?.code === "SIGNER_UNAVAILABLE") throw new MintError("SIGNER_UNAVAILABLE");
      throw new MintError("SEND_FAILED");
    }
    let tx;
    try {
      tx = await provider.broadcastTransaction(raw);
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
    get address() {
      return attesterAddress();
    },
    attest: (up, expiresAtSec, primary, { onSent } = {}) => send("attest", [up, SOURCE_CIE, expiresAtSec, primary], onSent),
    invalidate: (up, reason, { onSent } = {}) => send("invalidate", [up, encodeBytes32String(reason)], onSent),
  };
}
