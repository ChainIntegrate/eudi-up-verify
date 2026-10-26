// Client of the signer process (audit UCL-08, ../../signer): the backend no longer holds ATTESTER_PRIVATE_KEY,
// UNIQ_PEPPER or CERT_REF_KEY; it asks the signer on a local socket, one JSON line per request.
// Errors keep the signer's codes (RATE_LIMITED, TX_REFUSED, ...); SIGNER_UNAVAILABLE when it does not answer.
import net from "node:net";

export const SIGNER_PROTOCOL = 1;

export class SignerError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** Transport over the Unix socket: one connection per request (few requests, simple and robust). */
export function socketTransport(socketPath, { timeoutMs = 10_000 } = {}) {
  let seq = 0;
  return (op, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const sock = net.createConnection(socketPath);
      let buf = "";
      const done = (fn, v) => {
        clearTimeout(timer);
        sock.destroy();
        fn(v);
      };
      const timer = setTimeout(() => done(reject, new SignerError("SIGNER_UNAVAILABLE")), timeoutMs);
      sock.setEncoding("utf8");
      sock.on("connect", () => sock.write(`${JSON.stringify({ ...params, op, id })}\n`));
      sock.on("data", (chunk) => {
        buf += chunk;
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        let res;
        try {
          res = JSON.parse(buf.slice(0, nl));
        } catch {
          return done(reject, new SignerError("SIGNER_UNAVAILABLE"));
        }
        if (res.ok) done(resolve, res.result);
        else done(reject, new SignerError(res.error ?? "SIGNER_ERROR"));
      });
      sock.on("error", () => done(reject, new SignerError("SIGNER_UNAVAILABLE")));
    });
}

/** In-process transport over a signer core (tests): same requests and error codes, no socket. */
export function coreTransport(core) {
  return async (op, params = {}) => {
    try {
      return JSON.parse(JSON.stringify(await core.handle({ ...params, op }))); // as if it went through JSON
    } catch (e) {
      throw new SignerError(e?.code ?? "SIGNER_ERROR");
    }
  };
}

/** The signer's operations, with Buffers where the backend stores bytes. */
export function createSigner(transport) {
  return {
    hello: () => transport("hello"),
    status: () => transport("status"),
    personKey: async (taxCode) => Buffer.from((await transport("personKey", { taxCode })).key, "hex"),
    encryptCertRef: async (certRef) => Buffer.from((await transport("encryptCertRef", { certRef })).blob, "hex"),
    decryptCertRef: async (blob) => (await transport("decryptCertRef", { blob: Buffer.from(blob).toString("hex") })).certRef,
    signTx: async (tx) => (await transport("signTx", { tx })).raw,
  };
}

/**
 * Checks the signer at start-up: protocol, contract, chain and the UNIQ_PEPPER check value, which is stored at the
 * first start (kv "signer.pepperCheck") and must never change: a pepper copied wrong would silently break
 * "one person, one primary UP". Returns {address} or throws SignerError (SIGNER_PROTOCOL, SIGNER_CONFIG,
 * PEPPER_MISMATCH, SIGNER_UNAVAILABLE).
 */
export async function checkSigner(signer, { contract, chainId, kvGet, kvSet }) {
  const h = await signer.hello();
  if (h.protocol !== SIGNER_PROTOCOL) throw new SignerError("SIGNER_PROTOCOL");
  if (h.contract?.toLowerCase() !== contract.toLowerCase() || h.chainId !== chainId) throw new SignerError("SIGNER_CONFIG");
  const stored = kvGet("signer.pepperCheck");
  if (stored === null) kvSet("signer.pepperCheck", h.pepperCheck);
  else if (stored !== h.pepperCheck) throw new SignerError("PEPPER_MISMATCH");
  return { address: h.address };
}
