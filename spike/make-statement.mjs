// Generates the statement that both the Universal Profile and the CIE will sign.
// ASCII only, LF line endings, no trailing newline: the bytes must be reproducible.
//
// Usage: node make-statement.mjs --up 0x... [--origin https://...] [--chain-id 4201] [--hours 24] [--out enunciato.txt]

import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    up: { type: "string" },
    origin: { type: "string", default: "https://up-cie-link.local" },
    "chain-id": { type: "string", default: "4201" },
    contract: { type: "string", default: "0x0000000000000000000000000000000000000000" },
    hours: { type: "string", default: "24" },
    out: { type: "string" },
  },
});

if (!args.up || !/^0x[0-9a-fA-F]{40}$/.test(args.up)) {
  console.error("Missing or invalid --up (expected 0x + 40 hex chars)");
  process.exit(2);
}

const issued = new Date();
const expires = new Date(issued.getTime() + Number(args.hours) * 3600_000);
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

const lines = [
  "up-cie-link statement v1",
  `Origin: ${args.origin}`,
  `Chain-Id: ${args["chain-id"]}`,
  `Contract: ${args.contract}`,
  `Universal-Profile: ${args.up}`,
  `Nonce: ${randomBytes(32).toString("base64url")}`,
  `Issued-At: ${iso(issued)}`,
  `Expires-At: ${iso(expires)}`,
  "I declare that I control this Universal Profile and that I hold the CIE used to sign this statement.",
  "Dichiaro di controllare questo Universal Profile e di essere titolare della CIE con cui firmo questo enunciato.",
];
const text = lines.join("\n");

if (!/^[\x0a\x20-\x7e]*$/.test(text)) throw new Error("statement must be ASCII only");

if (args.out) {
  writeFileSync(args.out, text, { encoding: "ascii" });
  console.error(`Statement written to ${args.out} (${Buffer.byteLength(text)} bytes)`);
} else {
  process.stdout.write(text);
}
