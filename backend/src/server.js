// Entry point: binds to 127.0.0.1 only (nginx in front). Refuses to start if the port is busy.
import { createApp } from "./app.js";
import { createBadgeReader, createMinter } from "./chain.js";
import { loadTrustStore } from "./cie/trust.js";
import { createCieFlow, failInterrupted } from "./cieFlow.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { createSerialQueue } from "./queue.js";
import { createProvider, createUpChecker } from "./up.js";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const provider = createProvider(cfg.rpcUrl, cfg.deployment.chainId);

// Ask the RPC itself: the provider uses a static network and would not detect a wrong endpoint.
let rpcChainId;
try {
  rpcChainId = Number(await provider.send("eth_chainId", []));
} catch {
  console.error("RPC not reachable");
  process.exit(1);
}
if (rpcChainId !== cfg.deployment.chainId) {
  console.error(`RPC chainId ${rpcChainId} does not match ${cfg.network} (${cfg.deployment.chainId})`);
  process.exit(1);
}

const badge = createBadgeReader(provider, cfg.deployment.address);
const minter = createMinter(provider, cfg.deployment.address, cfg.attesterPrivateKey);
const onChainAttester = await badge.attester();
if (onChainAttester.toLowerCase() !== minter.address.toLowerCase()) {
  console.error(`ATTESTER_PRIVATE_KEY is not the contract's attester (${onChainAttester})`);
  process.exit(1);
}
const trust = loadTrustStore(cfg.trustDir, cfg.cieRootSha256);
const interrupted = failInterrupted(db);
if (interrupted) console.warn(`${interrupted} statement(s) interrupted by the previous shutdown marked as failed`);

const cieFlow = createCieFlow({
  db,
  cfg,
  trust,
  pepper: cfg.uniqPepper,
  certRefKey: cfg.certRefKey,
  badge,
  minter,
  queue: createSerialQueue(),
});
const app = createApp({ db, cfg, upChecker: createUpChecker(provider), cieFlow, badge });
const server = app.listen(cfg.port, "127.0.0.1", () => {
  console.log(`up-cie-link backend on 127.0.0.1:${cfg.port} (${cfg.network}, contract ${cfg.deployment.address})`);
  console.log(`attester ${minter.address}, trust store: ${trust.roots.length} root(s), ${trust.intermediates.length} intermediate(s)`);
});
server.on("error", (e) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${cfg.port} is already in use: choose another PORT` : `Server error: ${e.code}`);
  process.exit(1);
});

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
