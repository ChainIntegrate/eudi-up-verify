// LSP2 arrays and maps for the authorship of the badge collection (mainnet phase A, decision M3 of 2026-10-27):
//  - LSP4Creators[] + LSP4CreatorsMap on the badge contract: the owner UP is its creator;
//  - LSP12IssuedAssets[] + LSP12IssuedAssetsMap on the owner UP: the badge contract is an asset it issued.
// Keys and interface ids as in @lukso/lsp4-contracts, @lukso/lsp12-contracts, lsp0 and lsp8 (checked by the tests).
// Arrays are appended to: existing entries (other assets of the owner UP) are kept.
import { concat, getAddress, toBeHex, zeroPadValue } from "ethers";

export const LSP4_CREATORS_ARRAY = "0x114bd03b3a46d48759680d81ebb2b414fda7d030a7105a851867accf1c2352e7";
export const LSP4_CREATORS_MAP = "0x6de85eaf5d982b4e5da00000";
export const LSP12_ISSUED_ARRAY = "0x7c8c3416d6cda87cd42c71ea1843df28ac4850354f988d55ee2eaa47b6dc05cd";
export const LSP12_ISSUED_MAP = "0x74ac2555c10b9349e78f0000";
export const INTERFACE_ID_LSP0 = "0x24871b3d";
export const INTERFACE_ID_LSP8 = "0x3a271706";

const u128 = (n) => zeroPadValue(toBeHex(n), 16);

/** Map key of `address` under a 12-byte map prefix. */
export const mapKey = (prefix, address) => `${prefix}${getAddress(address).slice(2).toLowerCase()}`;

/** Length stored under an LSP2 array key (empty value = 0). */
export const arrayLength = (value) => (value && value !== "0x" ? Number(BigInt(value)) : 0);

/** Keys and values that append `item` to an LSP2 array of length `length`, with its map entry. */
export function appendEntry({ arrayKey, mapPrefix, item, interfaceId, length }) {
  return {
    keys: [arrayKey, `${arrayKey.slice(0, 34)}${u128(length).slice(2)}`, mapKey(mapPrefix, item)],
    values: [u128(length + 1), getAddress(item), concat([interfaceId, u128(length)])],
  };
}
