// Builds the LSP4Metadata of the UpCieBadge collection (name, description EN/IT, icon) and the value to store
// on-chain. The JSON and the icon are served by the site itself (no IPFS, no third-party service):
//   https://<site>/metadata/badge.json  and  https://<site>/metadata/badge-icon.png
//
//   node scripts/lsp4-metadata.mjs [--site https://up-cie-link.chainintegrate.it] [--network luksoTestnet]
//
// Writes ../frontend/metadata/badge.json and prints:
//   - the VerifiableURI for the data key LSP4Metadata (keccak256(utf8) of the JSON + its URL);
//   - the calldata of setData(LSP4Metadata, value) on the badge, and of the owner UP's execute() that wraps it.
// The owner UP must send that execute(): nothing is sent by this script.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Interface, concat, keccak256, toUtf8Bytes } from "ethers";

const LSP4_METADATA_KEY = "0x9afb95cacc9f95858ec44aa8c3b685511002e30ae54415823f406128b85b238e"; // keccak256("LSP4Metadata")
const KECCAK256_UTF8 = "0x6f357c6a"; // LSP2 verification method of the JSON
const KECCAK256_BYTES = "keccak256(bytes)"; // LSP4 verification method of images

const { values } = parseArgs({
  options: { site: { type: "string", default: "https://up-cie-link.chainintegrate.it" }, network: { type: "string", default: "luksoTestnet" } },
});
const site = values.site.replace(/\/$/, "");
const frontend = fileURLToPath(new URL("../../frontend/metadata/", import.meta.url));
const deployment = JSON.parse(readFileSync(new URL(`../deployments/${values.network}.json`, import.meta.url), "utf8"));

const icon = readFileSync(`${frontend}badge-icon.png`);
const image = { width: 800, height: 800, url: `${site}/metadata/badge-icon.png`, verification: { method: KECCAK256_BYTES, data: keccak256(icon) } };
const metadata = {
  LSP4Metadata: {
    name: "UP CIE Link",
    description:
      "Non-transferable badge: the holder of this Universal Profile also signed a statement with a valid Italian electronic identity card (CIE). " +
      "No name, tax code or card data on-chain. Experimental service by ChainIntegrate, not a public service.\n\n" +
      "Bollino non trasferibile: il titolare di questa Universal Profile ha firmato un enunciato anche con una Carta d'Identità Elettronica valida. " +
      "Nessun nome, codice fiscale o dato della carta on-chain. Servizio sperimentale di ChainIntegrate, non è un servizio pubblico.",
    links: [
      { title: "Verify / Verifica", url: `${site}/verifica` },
      { title: "Source code", url: "https://github.com/ChainIntegrate/up-cie-link" },
    ],
    icons: [image],
    images: [[image]],
    assets: [],
    attributes: [{ key: "Type", value: "Identity badge", type: "string" }],
  },
};
const json = JSON.stringify(metadata, null, 2) + "\n";
writeFileSync(`${frontend}badge.json`, json);

const url = `${site}/metadata/badge.json`;
const value = concat(["0x0000", KECCAK256_UTF8, "0x0020", keccak256(toUtf8Bytes(json)), toUtf8Bytes(url)]);
const setData = new Interface(["function setData(bytes32 dataKey, bytes dataValue)"]).encodeFunctionData("setData", [LSP4_METADATA_KEY, value]);
const execute = new Interface(["function execute(uint256 operationType, address target, uint256 value, bytes data)"]).encodeFunctionData("execute", [0, deployment.address, 0, setData]);

console.log(`badge ${deployment.address} (${values.network}), owner UP ${deployment.owner}`);
console.log(`written ${frontend}badge.json (serve it unchanged at ${url})`);
console.log(`\nLSP4Metadata key:   ${LSP4_METADATA_KEY}\nVerifiableURI:      ${value}`);
console.log(`\nbadge.setData calldata (to: ${deployment.address}):\n${setData}`);
console.log(`\nowner UP execute calldata (to: ${deployment.owner}):\n${execute}`);
