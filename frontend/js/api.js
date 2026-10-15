// Backend API, same origin (nginx proxies /api). The browser never talks to an RPC node.
export class ApiError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function call(path, { method = "GET", json, body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: json !== undefined ? { "Content-Type": "application/json" } : body ? { "Content-Type": "application/octet-stream" } : {},
      body: json !== undefined ? JSON.stringify(json) : body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("NETWORK", 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or not JSON */ }
  if (!res.ok) throw new ApiError(data?.error ?? `HTTP_${res.status}`, res.status);
  return data;
}

export const api = {
  config: () => call("/api/config"),
  createStatement: (up, mode) => call("/api/statements", { method: "POST", json: { up, mode } }),
  statement: (id) => call(`/api/statements/${encodeURIComponent(id)}`),
  statementFileUrl: (id) => `/api/statements/${encodeURIComponent(id)}/file`,
  upSignature: (id, signature) => call(`/api/statements/${encodeURIComponent(id)}/up-signature`, { method: "POST", json: { signature } }),
  cieCades: (id, bytes) => call(`/api/statements/${encodeURIComponent(id)}/cie-cades`, { method: "POST", body: bytes }),
  badge: (up) => call(`/api/badge/${encodeURIComponent(up)}`),
  // admin (session cookie, same origin)
  admin: {
    session: () => call("/api/admin/session"),
    challenge: (up) => call("/api/admin/challenge", { method: "POST", json: { up } }),
    login: (id, signature) => call("/api/admin/login", { method: "POST", json: { id, signature } }),
    logout: () => call("/api/admin/logout", { method: "POST", json: {} }),
    status: () => call("/api/admin/status"),
    exceptions: () => call("/api/admin/exceptions"),
    reject: (ticket) => call(`/api/admin/exceptions/${encodeURIComponent(ticket)}/reject`, { method: "POST", json: {} }),
    badge: (up) => call(`/api/admin/badge/${encodeURIComponent(up)}`),
    tx: (action, args) => call("/api/admin/tx", { method: "POST", json: { action, args } }),
    log: (action, txHash, detail) => call("/api/admin/log", { method: "POST", json: { action, txHash, detail } }),
  },
};
