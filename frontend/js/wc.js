// UP Wallet for Android through WalletConnect (docs/03-frontend.md §5, decisions W1-W4 and P1-P8 of 2026-10-26).
// The dApp side is Reown's sign-client, the same file as Cross_Chain's (vendor/, pinned, Subresource Integrity),
// loaded only when the person chooses UP Wallet or a session was kept in this browser. No usage telemetry.
// The browser still never calls an RPC node: requests go to UP Wallet through the relay, end-to-end encrypted.
const WC_SRC = "/vendor/signclient-2.25.0.min.js";
const WC_SRI = "sha384-c7w3byL5Bai+XyQvcREtZ7kvdwoPYwG+Rp5DN/jAW59Jy0osp0u/gsgdp4YOsVUJ";
const QR_SRC = "/vendor/qrcode-generator-1.4.4.js";
const QR_SRI = "sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k";
const PREFIX = "up-cie-link";
const MARK = "ucl-wc-session"; // the kept session's topic (P2: until "Disconnect")
const METHODS = ["personal_sign", "eth_sendTransaction"];

const loaded = {};
function loadScript(src, integrity) {
  loaded[src] ??= new Promise((ok, no) => {
    const el = document.createElement("script");
    el.src = src;
    el.integrity = integrity;
    el.onload = ok;
    el.onerror = () => {
      delete loaded[src];
      no(Object.assign(new Error("WC_LOAD_FAILED"), { code: "WC_LOAD_FAILED" }));
    };
    document.head.append(el);
  });
  return loaded[src];
}

const mark = {
  get() { try { return localStorage.getItem(MARK); } catch { return null; } },
  set(v) { try { localStorage.setItem(MARK, v); } catch { /* not kept */ } },
  del() { try { localStorage.removeItem(MARK); } catch { /* nothing kept */ } },
};

// The SDK sends an "INIT" event to Reown's telemetry even with telemetry off: mute its event client (as Cross_Chain).
function muteTelemetry(core) {
  if (!core?.eventClient) return;
  core.eventClient.init = async () => {};
  core.eventClient.sendEvent = async () => ({ ok: true });
}

let clientPromise = null;
function signClient(projectId) {
  clientPromise ??= (async () => {
    if (!window.SignClientBundle) await loadScript(WC_SRC, WC_SRI);
    const { Core, SignClient } = window.SignClientBundle;
    const core = new Core({ projectId, customStoragePrefix: PREFIX, telemetryEnabled: false });
    muteTelemetry(core);
    return SignClient.init({
      core,
      projectId,
      customStoragePrefix: PREFIX,
      metadata: {
        name: "UP CIE Link",
        description: "Link a Universal Profile to an Italian CIE",
        url: location.origin,
        icons: [`${location.origin}/img/logo.png`],
      },
    });
  })().catch((e) => {
    clientPromise = null;
    throw e;
  });
  return clientPromise;
}

/** QR code of the pairing link, as an image data URL (img-src allows data:). */
export async function qrDataUrl(text) {
  if (!window.qrcode) await loadScript(QR_SRC, QR_SRI);
  const q = window.qrcode(0, "M");
  q.addData(text);
  q.make();
  return q.createDataURL(5, 2);
}

const accountOn = (session, chainId) => {
  const accs = session?.namespaces?.eip155?.accounts ?? [];
  const a = accs.find((x) => x.startsWith(`eip155:${chainId}:`));
  return a ? a.split(":")[2] : null;
};

const isRejection = (e) => [4001, 5000, 5002].includes(e?.code) || /reject|denied|cancel/i.test(e?.message ?? "");

/** An EIP-1193-like connector over a WalletConnect session, as up.js expects (kind, request, onAccountsChanged, disconnect). */
function connector(client, session, chainId, onPending) {
  const topic = session.topic;
  const up = accountOn(session, chainId);
  const listeners = [];
  client.on("session_delete", ({ topic: t }) => {
    if (t !== topic) return;
    mark.del();
    listeners.forEach((cb) => cb([]));
  });
  return {
    kind: "walletconnect",
    peerName: session.peer?.metadata?.name ?? "WalletConnect",
    async request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [up];
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (!METHODS.includes(method)) throw Object.assign(new Error("unsupported"), { code: 4200 });
      // Back from the app: the relay socket may have been closed while the page was in the background
      if (!client.core.relayer.connected) await client.core.relayer.restartTransport().catch(() => {});
      onPending(true);
      try {
        return await client.request({ topic, chainId: `eip155:${chainId}`, request: { method, params } });
      } catch (e) {
        if (isRejection(e)) throw Object.assign(new Error("rejected"), { code: 4001 });
        throw e;
      } finally {
        onPending(false);
      }
    },
    onAccountsChanged: (cb) => listeners.push(cb),
    async disconnect() {
      mark.del();
      try {
        await client.disconnect({ topic, reason: window.SignClientBundle.getSdkError("USER_DISCONNECTED") });
      } catch { /* already gone */ }
    },
  };
}

/** The session kept in this browser (P2), or null. Loads the bundle only when a session was kept. */
export async function restoreUpWallet({ projectId, chainId, onPending }) {
  const topic = mark.get();
  if (!topic || !projectId) return null;
  try {
    const client = await signClient(projectId);
    const session = client.session.getAll().find((s) => s.topic === topic);
    if (!session || session.expiry * 1000 < Date.now() || !accountOn(session, chainId)) {
      mark.del();
      return null;
    }
    return connector(client, session, chainId, onPending);
  } catch {
    return null;
  }
}

/**
 * Starts a pairing: onUri(uri) is called with the wc: link to show (QR, open, copy). Resolves to a connector,
 * or rejects with code WC_REJECTED / WC_WRONG_CHAIN / WC_FAILED / WC_LOAD_FAILED. cancel() stops it (resolves null).
 */
export function pairUpWallet({ projectId, chainId, onUri, onPending }) {
  let cancelled = false;
  let client = null;
  let pairingTopic = null;
  let onVisible = null;
  const stop = () => onVisible && document.removeEventListener("visibilitychange", onVisible);
  const promise = (async () => {
    client = await signClient(projectId);
    if (cancelled) return null;
    const { uri, approval } = await client.connect({
      optionalNamespaces: { eip155: { chains: [`eip155:${chainId}`], methods: METHODS, events: ["accountsChanged", "chainChanged"] } },
    });
    if (cancelled) return null;
    pairingTopic = uri.slice(3).split("@")[0];
    onUri(uri);
    // Back from UP Wallet on the same phone: reconnect the relay and pick up a session approved meanwhile
    const approved = new Promise((resolve) => {
      onVisible = () => {
        if (document.visibilityState !== "visible") return;
        if (!client.core.relayer.connected) client.core.relayer.restartTransport().catch(() => {});
        const s = client.session.getAll().find((x) => x.pairingTopic === pairingTopic);
        if (s) resolve(s);
      };
      document.addEventListener("visibilitychange", onVisible);
    });
    let session;
    try {
      session = await Promise.race([approval(), approved]);
    } catch (e) {
      throw Object.assign(new Error("pairing"), { code: isRejection(e) ? "WC_REJECTED" : "WC_FAILED" });
    }
    if (cancelled) return null;
    if (!accountOn(session, chainId)) {
      client.disconnect({ topic: session.topic, reason: window.SignClientBundle.getSdkError("UNSUPPORTED_CHAINS") }).catch(() => {});
      throw Object.assign(new Error("chain"), { code: "WC_WRONG_CHAIN" });
    }
    mark.set(session.topic);
    return connector(client, session, chainId, onPending);
  })().finally(stop);
  return {
    promise,
    cancel() {
      cancelled = true;
      stop();
      if (client && pairingTopic) client.core.pairing.disconnect({ topic: pairingTopic }).catch(() => {});
    },
  };
}
