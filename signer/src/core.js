// The signer's logic (audit UCL-08), without I/O so it can be tested directly.
// It holds the three secrets the backend no longer sees and answers a fixed set of requests:
//  - hello:          protocol version, attester address, a check value of UNIQ_PEPPER (not the secret);
//  - personKey:      HMAC-SHA256(UNIQ_PEPPER, tax code), the person's pseudonymous key;
//  - encryptCertRef / decryptCertRef: the certificate reference, AES-256-GCM with CERT_REF_KEY;
//  - signTx:         signs an attester transaction, only attest() or invalidate() on our contract, value 0, our
//                    chain, under the gas and fee caps;
//  - status:         counters of the rate limits.
// Rate limits hold even when the backend is compromised: at most so many mints, invalidations, person keys and
// decryptions per period. A refused request answers RATE_LIMITED; the backend tells the person to retry later.
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { Interface, Transaction, Wallet, getAddress, isAddress } from "ethers";

export const PROTOCOL = 1;
const CERT_REF_VERSION = 1;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const IFACE = new Interface([
  "function attest(address up, bytes32 source, uint64 expiresAt, bool primary)",
  "function invalidate(address up, bytes32 reason)",
]);

export class SignerError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const DEFAULT_LIMITS = {
  attestPerHour: 20,
  attestPerDay: 100,
  invalidatePerHour: 100,
  personKeyPerMinute: 30,
  decryptPerDay: 2000,
  maxGas: 1_000_000n,
  maxFeePerGas: 100_000_000_000n, // 100 gwei
};

/** Sliding-window counter: `max` events per `windowMs` (the caller checks used() < max before take()). */
function limiter(max, windowMs) {
  const times = [];
  return {
    max,
    take(now) {
      times.push(now);
    },
    used(now) {
      while (times.length && times[0] <= now - windowMs) times.shift();
      return times.length;
    },
  };
}

const hexBuf = (name, v, min) => {
  if (typeof v !== "string" || !/^(0x)?[0-9a-fA-F]+$/.test(v)) throw new Error(`${name} must be hex`);
  const b = Buffer.from(v.replace(/^0x/, ""), "hex");
  if (b.length < min) throw new Error(`${name} must be at least ${min} bytes`);
  return b;
};

/**
 * @param {{attesterKey: string, pepper: string, certRefKey: string, contract: string, chainId: number,
 *          limits?: Partial<typeof DEFAULT_LIMITS>, clock?: () => number}} cfg
 */
export function createSignerCore({ attesterKey, pepper, certRefKey, contract, chainId, limits = {}, clock = Date.now }) {
  const wallet = new Wallet(attesterKey);
  const pepperBuf = hexBuf("UNIQ_PEPPER", pepper, 32);
  const refKey = hexBuf("CERT_REF_KEY", certRefKey, 32).subarray(0, 32);
  if (!isAddress(contract)) throw new Error("SIGNER_CONTRACT must be an address");
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error("SIGNER_CHAIN_ID must be a chain id");
  const target = getAddress(contract);
  const L = { ...DEFAULT_LIMITS, ...limits };
  const counters = {
    attestHour: limiter(L.attestPerHour, HOUR),
    attestDay: limiter(L.attestPerDay, DAY),
    invalidateHour: limiter(L.invalidatePerHour, HOUR),
    personKeyMinute: limiter(L.personKeyPerMinute, 60_000),
    decryptDay: limiter(L.decryptPerDay, DAY),
  };
  const refused = { attest: 0, invalidate: 0, personKey: 0, decryptCertRef: 0 };
  const take = (name, ...lims) => {
    const now = clock();
    // check every window first, so a refusal does not consume the others
    if (lims.some((l) => l.used(now) >= l.max)) {
      refused[name]++;
      throw new SignerError("RATE_LIMITED");
    }
    lims.forEach((l) => l.take(now));
  };
  // A value derived from UNIQ_PEPPER that reveals nothing about it: the backend compares it with the one stored
  // at the first start, so a pepper copied wrong (which would silently break "one person, one UP") is caught.
  const pepperCheck = createHmac("sha256", pepperBuf).update("up-cie-link:pepper-check:v1").digest("hex").slice(0, 32);

  const ops = {
    hello: () => ({ protocol: PROTOCOL, address: wallet.address, contract: target, chainId, pepperCheck }),

    personKey({ taxCode }) {
      if (typeof taxCode !== "string" || !/^[A-Z0-9]{16}$/i.test(taxCode)) throw new SignerError("BAD_REQUEST");
      take("personKey", counters.personKeyMinute);
      return { key: createHmac("sha256", pepperBuf).update(`up-cie-link:person:v1:${taxCode.toUpperCase()}`).digest("hex") };
    },

    encryptCertRef({ certRef }) {
      if (!certRef || typeof certRef !== "object") throw new SignerError("BAD_REQUEST");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", refKey, iv);
      const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(certRef), "utf8")), cipher.final()]);
      return { blob: Buffer.concat([Buffer.from([CERT_REF_VERSION]), iv, cipher.getAuthTag(), enc]).toString("hex") };
    },

    decryptCertRef({ blob }) {
      if (typeof blob !== "string" || !/^[0-9a-f]+$/i.test(blob)) throw new SignerError("BAD_REQUEST");
      take("decryptCertRef", counters.decryptDay);
      const b = Buffer.from(blob, "hex");
      if (b.length < 30 || b[0] !== CERT_REF_VERSION) throw new SignerError("BAD_REQUEST");
      try {
        const decipher = createDecipheriv("aes-256-gcm", refKey, b.subarray(1, 13));
        decipher.setAuthTag(b.subarray(13, 29));
        return { certRef: JSON.parse(Buffer.concat([decipher.update(b.subarray(29)), decipher.final()]).toString("utf8")) };
      } catch {
        throw new SignerError("DECRYPT_FAILED");
      }
    },

    async signTx({ tx }) {
      if (!tx || typeof tx !== "object") throw new SignerError("BAD_REQUEST");
      let parsed;
      let gasLimit;
      let maxFee;
      let maxPriority;
      let nonce;
      try {
        gasLimit = BigInt(tx.gasLimit);
        maxFee = BigInt(tx.maxFeePerGas);
        maxPriority = BigInt(tx.maxPriorityFeePerGas);
        nonce = Number(tx.nonce);
        parsed = IFACE.parseTransaction({ data: tx.data });
      } catch {
        throw new SignerError("TX_REFUSED");
      }
      const refuse = !parsed ||
        !isAddress(tx.to ?? "") || getAddress(tx.to) !== target ||
        Number(tx.chainId) !== chainId ||
        BigInt(tx.value ?? 0) !== 0n ||
        !Number.isSafeInteger(nonce) || nonce < 0 ||
        gasLimit <= 0n || gasLimit > L.maxGas ||
        maxFee <= 0n || maxFee > L.maxFeePerGas || maxPriority < 0n || maxPriority > maxFee;
      if (refuse) throw new SignerError("TX_REFUSED");
      if (parsed.name === "attest") take("attest", counters.attestHour, counters.attestDay);
      else take("invalidate", counters.invalidateHour);
      const raw = await wallet.signTransaction(Transaction.from({
        type: 2, chainId, to: target, data: tx.data, value: 0n, nonce, gasLimit, maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPriority,
      }));
      return { raw, fn: parsed.name };
    },

    status() {
      const now = clock();
      return {
        used: {
          attestHour: counters.attestHour.used(now),
          attestDay: counters.attestDay.used(now),
          invalidateHour: counters.invalidateHour.used(now),
          personKeyMinute: counters.personKeyMinute.used(now),
          decryptDay: counters.decryptDay.used(now),
        },
        limits: { attestPerHour: L.attestPerHour, attestPerDay: L.attestPerDay, invalidatePerHour: L.invalidatePerHour, personKeyPerMinute: L.personKeyPerMinute, decryptPerDay: L.decryptPerDay },
        refused: { ...refused },
      };
    },
  };

  /** One request: {op, ...params} -> result. Throws SignerError with a stable code. */
  async function handle(req) {
    const fn = req && typeof req.op === "string" && Object.hasOwn(ops, req.op) ? ops[req.op] : null;
    if (!fn) throw new SignerError("UNKNOWN_OP");
    return fn(req);
  }

  return { handle, address: wallet.address };
}
