// Universal Profile checks through the backend's RPC (the browser never calls the RPC).
//  - isUniversalProfile: ERC-165 supportsInterface(LSP0)
//  - isValidUpSignature: ERC-1271 isValidSignature(EIP-191 hash of the statement, signature) on the UP,
//    which delegates to its Key Manager (the signing controller needs the SIGN permission).
import { Contract, JsonRpcProvider, hashMessage, isHexString } from "ethers";

export const INTERFACE_ID_LSP0 = "0x24871b3d";
export const ERC1271_MAGIC = "0x1626ba7e";

const ABI = [
  "function supportsInterface(bytes4) view returns (bool)",
  "function isValidSignature(bytes32 dataHash, bytes signature) view returns (bytes4)",
];

/** Chain adapter used by the routes; replaceable in tests. */
export function createUpChecker(provider) {
  return {
    async isUniversalProfile(up) {
      try {
        return await new Contract(up, ABI, provider).supportsInterface(INTERFACE_ID_LSP0);
      } catch {
        return false;
      }
    },
    async isValidUpSignature(up, message, signature) {
      if (!isHexString(signature) || (signature.length - 2) / 2 !== 65) return false;
      try {
        const res = await new Contract(up, ABI, provider).isValidSignature(hashMessage(message), signature);
        return res.toLowerCase() === ERC1271_MAGIC;
      } catch {
        return false;
      }
    },
  };
}

export function createProvider(rpcUrl, chainId) {
  // no request cache: consecutive reads (nonce, badge state) must always reach the node
  return new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true, cacheTimeout: -1 });
}
