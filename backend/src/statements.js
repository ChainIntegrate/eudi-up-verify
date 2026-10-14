// Statements: the exact text that both the Universal Profile and the CIE sign.
// ASCII only, LF line endings, no trailing newline, so that the bytes are reproducible everywhere.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getAddress } from "ethers";

export const STATEMENT_VERSION = "v1";
export const MODES = ["link", "migrate", "additional"];

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export function buildStatementText({ origin, chainId, contract, up, mode, nonce, issuedAt, expiresAt }) {
  const text = [
    `up-cie-link statement ${STATEMENT_VERSION}`,
    `Origin: ${origin}`,
    `Chain-Id: ${chainId}`,
    `Contract: ${contract}`,
    `Universal-Profile: ${up}`,
    `Mode: ${mode}`,
    `Nonce: ${nonce}`,
    `Issued-At: ${iso(issuedAt)}`,
    `Expires-At: ${iso(expiresAt)}`,
    "I declare that I control this Universal Profile and that I hold the CIE used to sign this statement.",
    "Dichiaro di controllare questo Universal Profile e di essere titolare della CIE con cui firmo questo enunciato.",
  ].join("\n");
  if (!/^[\x0a\x20-\x7e]*$/.test(text)) throw new Error("statement must be ASCII");
  return text;
}

export const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");

/** Creates and stores a statement. The text is not stored: it is rebuilt from the row (and checked by hash). */
export function createStatement(db, cfg, { up, mode }, now = Date.now()) {
  const checksummed = getAddress(up);
  if (!MODES.includes(mode)) throw Object.assign(new Error("invalid mode"), { code: "INVALID_MODE" });
  const row = {
    id: randomUUID(),
    up: checksummed,
    mode,
    nonce: randomBytes(32).toString("base64url"),
    issued_at: Math.floor(now / 1000) * 1000,
    expires_at: Math.floor(now / 1000) * 1000 + cfg.statementTtlSec * 1000,
  };
  const text = statementText(cfg, row);
  db.prepare(
    `INSERT INTO statements (id, up, mode, nonce, text_sha256, issued_at, expires_at, status)
     VALUES (@id, @up, @mode, @nonce, @text_sha256, @issued_at, @expires_at, 'pending_up')`,
  ).run({ ...row, text_sha256: sha256Hex(text) });
  return { ...row, text };
}

export function statementText(cfg, row) {
  return buildStatementText({
    origin: cfg.statementOrigin,
    chainId: cfg.deployment.chainId,
    contract: cfg.deployment.address,
    up: row.up,
    mode: row.mode,
    nonce: row.nonce,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  });
}

export function getStatement(db, id) {
  return db.prepare("SELECT * FROM statements WHERE id = ?").get(id) ?? null;
}

/** Status as seen by clients, with expiry applied lazily. */
export function publicStatus(row, cfg, now = Date.now()) {
  const terminal = ["done", "failed", "expired"].includes(row.status);
  const status = !terminal && now > row.expires_at ? "expired" : row.status;
  return {
    id: row.id,
    up: row.up,
    mode: row.mode,
    status,
    issuedAt: iso(row.issued_at),
    expiresAt: iso(row.expires_at),
    upSignatureDeadline: iso(row.issued_at + cfg.upSignatureWindowSec * 1000),
    errorCode: row.error_code ?? null,
    txHash: row.tx_hash ?? null,
  };
}
