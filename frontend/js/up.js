// Universal Profile through a wallet "connector" exposing an EIP-1193 request():
//  - "extension": the UP Browser Extension (window.lukso; window.ethereum as a fallback);
//  - "walletconnect": ChainIntegrate's UP Wallet for Android, through WalletConnect (wc.js).
// Only three things are asked of the wallet: the UP address, a signature of the statement, and the
// renounce() transaction sent by the UP itself.

// keccak256("renounce()")[0:4], checked against the contract ABI by the tests
export const RENOUNCE_SELECTOR = "0xb15be2f5";

export class WalletError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** The UP Browser Extension, or null when it is not installed. */
export function extensionWallet() {
  const p = window.lukso ?? window.ethereum ?? null;
  if (!p) return null;
  return {
    kind: "extension",
    request: (args) => p.request(args),
    onAccountsChanged: (cb) => p.on?.("accountsChanged", cb),
    disconnect: async () => {},
  };
}

const wrap = async (fn) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof WalletError) throw e;
    if (e?.code === 4001) throw new WalletError("WALLET_REJECTED");
    throw new WalletError("WALLET_ERROR");
  }
};

const isAddr = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

/** Asks the extension for the UP and makes sure it is on the expected chain. */
export async function connectUp(p, chainId) {
  if (!p) throw new WalletError("NO_EXTENSION");
  return wrap(async () => {
    const accounts = await p.request({ method: "eth_requestAccounts" });
    const up = accounts?.[0];
    if (!isAddr(up)) throw new WalletError("NO_ACCOUNT");
    const current = parseInt(await p.request({ method: "eth_chainId" }), 16);
    if (current !== chainId) {
      try {
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${chainId.toString(16)}` }] });
      } catch (e) {
        if (e?.code === 4001) throw e;
        throw new WalletError("WRONG_CHAIN");
      }
      const after = parseInt(await p.request({ method: "eth_chainId" }), 16);
      if (after !== chainId) throw new WalletError("WRONG_CHAIN");
    }
    return up;
  });
}

const toHex = (text) => "0x" + Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("");

/** EIP-191 signature of the statement by a controller of the UP (checked by the backend with ERC-1271). */
export function signStatement(p, up, text) {
  return wrap(async () => {
    const sig = await p.request({ method: "personal_sign", params: [toHex(text), up] });
    if (typeof sig !== "string" || !/^0x[0-9a-fA-F]+$/.test(sig)) throw new WalletError("WALLET_ERROR");
    return sig;
  });
}

/** A transaction sent by the UP (the wallet executes it through the UP); returns the transaction hash. */
export function sendFromUp(p, up, to, data) {
  return wrap(async () => {
    const hash = await p.request({ method: "eth_sendTransaction", params: [{ from: up, to, data, value: "0x0" }] });
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new WalletError("WALLET_ERROR");
    return hash;
  });
}

/** The UP calls renounce() on the badge contract; returns the transaction hash. */
export function renounce(p, up, contract) {
  return sendFromUp(p, up, contract, RENOUNCE_SELECTOR);
}
