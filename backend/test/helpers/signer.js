// The signer (../../../signer, audit UCL-08) for the tests: in process (same requests and error codes as over the
// socket), or as the real program on a socket in a temporary directory.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSignerCore } from "../../../signer/src/core.js";
import { coreTransport, createSigner } from "../../src/signer.js";

export const SIGNER_JS = fileURLToPath(new URL("../../../signer/src/signer.js", import.meta.url));
const hex = () => `0x${randomBytes(32).toString("hex")}`;

/** An in-process signer: returns {signer, core, address}. */
export function testSigner({ attesterKey = hex(), contract = "0x0000000000000000000000000000000000000001", chainId = 4201, pepper = hex(), certRefKey = hex(), limits, clock } = {}) {
  const core = createSignerCore({ attesterKey, pepper, certRefKey, contract, chainId, limits, clock });
  return { signer: createSigner(coreTransport(core)), core, address: core.address };
}

/** The real signer program on `<dir>/signer.sock`. Returns {socketPath, stop()} once it listens. */
export async function startSignerProcess(dir, { attesterKey, contract, chainId = 4201, pepper = hex(), certRefKey = hex(), extraEnv = {} }) {
  const socketPath = path.join(dir, "signer.sock");
  let logs = "";
  const child = spawn(process.execPath, [SIGNER_JS], {
    env: { PATH: process.env.PATH, SIGNER_SOCKET: socketPath, ATTESTER_PRIVATE_KEY: attesterKey, UNIQ_PEPPER: pepper, CERT_REF_KEY: certRefKey, SIGNER_CONTRACT: contract, SIGNER_CHAIN_ID: String(chainId), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (logs += d));
  child.stderr.on("data", (d) => (logs += d));
  for (let i = 0; i < 100 && !logs.includes("[signer] attester"); i++) await new Promise((r) => setTimeout(r, 50));
  if (!existsSync(socketPath)) throw new Error(`signer did not start:\n${logs}`);
  return { socketPath, logs: () => logs, stop: () => child.kill("SIGTERM") };
}
