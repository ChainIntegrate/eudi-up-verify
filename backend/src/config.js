// Configuration from the environment (and backend/.env if present; real env vars take precedence).
// The contract address and DEPLOY_BLOCK come from contracts/deployments/<NETWORK>.json (source of truth).
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseKey } from "./secrets.js";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const CHAIN_IDS = { luksoTestnet: 4201, luksoMainnet: 42 };

function required(name, env) {
  const v = env[name];
  if (v === undefined || v === "") throw new Error(`Missing configuration: ${name}`);
  return v;
}

function int(name, env, fallback) {
  const v = env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid integer for ${name}`);
  return n;
}

export function loadDeployment(network, deploymentsDir) {
  const file = `${deploymentsDir}/${network}.json`;
  if (!existsSync(file)) throw new Error(`Deployment record not found: ${file}`);
  const d = JSON.parse(readFileSync(file, "utf8"));
  if (d.chainId !== CHAIN_IDS[network]) throw new Error(`Deployment ${file} has chainId ${d.chainId}`);
  // UCL-38: earlier contracts of the same network, whose attester the owner sets to zero from the admin page
  const superseded = (d.superseded ?? []).map((s) => s.address);
  return { address: d.address, deployBlock: d.deployBlock, chainId: d.chainId, superseded };
}

/** @param {Record<string,string|undefined>} env */
export function loadConfig(env = process.env) {
  const network = required("NETWORK", env);
  if (!(network in CHAIN_IDS)) throw new Error(`NETWORK must be one of ${Object.keys(CHAIN_IDS).join(", ")}`);
  const deploymentsDir = env.DEPLOYMENTS_DIR || fileURLToPath(new URL("../../contracts/deployments", import.meta.url));
  const publicOrigin = required("PUBLIC_ORIGIN", env);
  return {
    network,
    deployment: loadDeployment(network, deploymentsDir),
    rpcUrl: required("RPC_URL", env),
    port: int("PORT", env, undefined) ?? (() => { throw new Error("Missing configuration: PORT"); })(),
    publicOrigin,
    statementOrigin: env.STATEMENT_ORIGIN || publicOrigin,
    dbPath: required("DB_PATH", env),
    upSignatureWindowSec: int("UP_SIGNATURE_WINDOW_SEC", env, 300), // B1: 5 minutes
    statementTtlSec: int("STATEMENT_TTL_SEC", env, 900), // B1: 15 minutes for the CIE signature
    allowCadesUpload: env.ALLOW_CADES_UPLOAD === "true", // B7
    allowRawChannel: env.ALLOW_RAW_CHANNEL === "true", // UCL-40: Android app channel, off until the app ships
    indexerMaxRange: int("INDEXER_MAX_RANGE", env, 2000),
    notifyEachLink: env.NOTIFY_EACH_LINK === "true", // one email per successful link: on during tests, then off
    backupDir: env.BACKUP_DIR || null, // shown on the admin page
    // the badge metadata JSON served by the site (admin page: compare with / write to the contract)
    metadataFile: env.METADATA_FILE || fileURLToPath(new URL("../../frontend/metadata/badge.json", import.meta.url)),
    // secrets (never logged)
    attesterPrivateKey: required("ATTESTER_PRIVATE_KEY", env),
    uniqPepper: parseKey("UNIQ_PEPPER", required("UNIQ_PEPPER", env)),
    certRefKey: parseKey("CERT_REF_KEY", required("CERT_REF_KEY", env)),
    // CIE trust store: CA certificates directory + pinned root SHA-256 fingerprints (comma separated)
    trustDir: env.TRUST_DIR || fileURLToPath(new URL("../trust", import.meta.url)),
    cieRootSha256: required("CIE_ROOT_SHA256", env).split(",").map((s) => s.trim()).filter(Boolean),
  };
}
