// up-cie-link signer (audit UCL-08): a separate process, run by systemd as its own user, with no network.
// It holds ATTESTER_PRIVATE_KEY, UNIQ_PEPPER and CERT_REF_KEY (from systemd's EnvironmentFile, readable by root
// only) and answers the backend on a local socket, one JSON object per line:
//   request  {"id": 1, "op": "personKey", "taxCode": "..."}
//   response {"id": 1, "ok": true, "result": {...}}  or  {"id": 1, "ok": false, "error": "RATE_LIMITED"}
// Logs carry operation names and error codes only, never parameters (tax codes, certificate references).
import { chmodSync, existsSync, rmSync } from "node:fs";
import net from "node:net";
import { DEFAULT_LIMITS, SignerError, createSignerCore } from "./core.js";

const MAX_LINE = 64 * 1024;

export function loadSignerConfig(env = process.env) {
  const int = (name, fallback) => {
    const v = env[name];
    if (v === undefined || v === "") return fallback;
    if (!/^\d+$/.test(v)) throw new Error(`${name} must be a whole number`);
    return Number(v);
  };
  const need = (name) => {
    if (!env[name]) throw new Error(`Missing configuration: ${name}`);
    return env[name];
  };
  return {
    socketPath: env.SIGNER_SOCKET || "/run/up-cie-link-signer/signer.sock",
    attesterKey: need("ATTESTER_PRIVATE_KEY"),
    pepper: need("UNIQ_PEPPER"),
    certRefKey: need("CERT_REF_KEY"),
    contract: need("SIGNER_CONTRACT"),
    chainId: int("SIGNER_CHAIN_ID", undefined),
    limits: {
      attestPerHour: int("SIGNER_MAX_ATTEST_PER_HOUR", DEFAULT_LIMITS.attestPerHour),
      attestPerDay: int("SIGNER_MAX_ATTEST_PER_DAY", DEFAULT_LIMITS.attestPerDay),
      invalidatePerHour: int("SIGNER_MAX_INVALIDATE_PER_HOUR", DEFAULT_LIMITS.invalidatePerHour),
      personKeyPerMinute: int("SIGNER_MAX_PERSON_KEYS_PER_MINUTE", DEFAULT_LIMITS.personKeyPerMinute),
      personKeyPerDay: int("SIGNER_MAX_PERSON_KEYS_PER_DAY", DEFAULT_LIMITS.personKeyPerDay),
      decryptPerDay: int("SIGNER_MAX_DECRYPT_PER_DAY", DEFAULT_LIMITS.decryptPerDay),
      maxGas: BigInt(int("SIGNER_MAX_GAS", Number(DEFAULT_LIMITS.maxGas))),
      maxFeePerGas: BigInt(int("SIGNER_MAX_FEE_GWEI", Number(DEFAULT_LIMITS.maxFeePerGas / 1_000_000_000n))) * 1_000_000_000n,
    },
  };
}

/** Serves `core` on a Unix socket. Returns the net.Server. */
export function serve(core, socketPath, { log = console } = {}) {
  if (existsSync(socketPath)) rmSync(socketPath); // left by a previous run
  const server = net.createServer((sock) => {
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("data", (chunk) => {
      buf += chunk;
      if (buf.length > MAX_LINE && !buf.includes("\n")) {
        sock.destroy();
        return;
      }
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        answer(line).then((out) => sock.writable && sock.write(`${JSON.stringify(out)}\n`));
      }
    });
    sock.on("error", () => {});
  });
  async function answer(line) {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return { id: null, ok: false, error: "BAD_REQUEST" };
    }
    const id = req?.id ?? null;
    try {
      const result = await core.handle(req);
      return { id, ok: true, result };
    } catch (e) {
      const code = e instanceof SignerError ? e.code : "INTERNAL";
      if (code !== "BAD_REQUEST") log.warn(`[signer] ${req?.op ?? "?"} refused: ${code}`);
      return { id, ok: false, error: code };
    }
  }
  server.listen(socketPath, () => chmodSync(socketPath, 0o660)); // owner and the backend's group only
  return server;
}

// started as a program (systemd), not imported by the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  process.umask(0o077);
  let cfg;
  let core;
  try {
    cfg = loadSignerConfig();
    core = createSignerCore(cfg);
  } catch (e) {
    console.error(`[signer] ${e.message}`);
    process.exit(1);
  }
  const server = serve(core, cfg.socketPath);
  server.on("listening", async () => {
    // the pepper check value is not secret: logged so that a migration can compare it (docs/operations.md §2.3b)
    const { pepperCheck } = await core.handle({ op: "hello" });
    console.log(`[signer] attester ${core.address}, contract ${cfg.contract} (chain ${cfg.chainId}), pepper check ${pepperCheck}, socket ${cfg.socketPath}`);
  });
  server.on("error", (e) => {
    console.error(`[signer] socket error: ${e.code}`);
    process.exit(1);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
