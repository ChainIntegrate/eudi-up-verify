// UCL-08: the signer process (../../signer): what it signs, what it refuses, its rate limits, and compatibility
// with the person keys and certificate references stored before the secrets moved to it.
import assert from "node:assert/strict";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { Interface, Transaction, Wallet, encodeBytes32String } from "ethers";
import { createSigner, socketTransport } from "../src/signer.js";
import { startSignerProcess, testSigner } from "./helpers/signer.js";

const CONTRACT = "0x6A525B5662EF905f3DD90F7139DC3a702b1371BA";
const UP = "0xC014c2cAd97F3D5d5fdBD6E09DA1e856E0659927";
const IFACE = new Interface([
  "function attest(address up, bytes32 source, uint64 expiresAt, bool primary)",
  "function invalidate(address up, bytes32 reason)",
  "function setAttester(address newAttester)",
]);
const hex32 = () => `0x${randomBytes(32).toString("hex")}`;
const tx = (over = {}) => ({
  to: CONTRACT,
  data: IFACE.encodeFunctionData("attest", [UP, encodeBytes32String("CIE"), 2_000_000_000, true]),
  value: "0",
  chainId: 4201,
  nonce: 7,
  gasLimit: "300000",
  maxFeePerGas: "2000000000",
  maxPriorityFeePerGas: "1000000000",
  ...over,
});
const rejectsCode = (p, code) => assert.rejects(p, (e) => e.code === code);

describe("UCL-08: signer", () => {
  const attesterKey = Wallet.createRandom().privateKey;
  const pepper = hex32();
  const certRefKey = hex32();
  let now = Date.parse("2026-10-27T10:00:00Z");
  const { signer } = testSigner({ attesterKey, pepper, certRefKey, contract: CONTRACT, chainId: 4201, clock: () => now });

  it("hello: protocol, attester address, contract, chain and a pepper check value that is not the pepper", async () => {
    const h = await signer.hello();
    assert.deepEqual({ ...h, pepperCheck: undefined }, { protocol: 1, address: new Wallet(attesterKey).address, contract: CONTRACT, chainId: 4201, pepperCheck: undefined });
    assert.match(h.pepperCheck, /^[0-9a-f]{32}$/);
    assert.ok(!pepper.includes(h.pepperCheck));
  });

  it("person keys and certificate references are the same as before the move (stored data stays valid)", async () => {
    // the backend's former code (src/secrets.js before UCL-08)
    const oldKey = createHmac("sha256", Buffer.from(pepper.slice(2), "hex")).update("up-cie-link:person:v1:RSSMRA80A01H501X").digest();
    assert.deepEqual(await signer.personKey("rssmra80a01h501x"), oldKey);
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", Buffer.from(certRefKey.slice(2), "hex"), iv);
    const enc = Buffer.concat([c.update(Buffer.from(JSON.stringify({ serialHex: "01ab", issuerSha256: "ff" }))), c.final()]);
    const oldBlob = Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), enc]);
    assert.deepEqual(await signer.decryptCertRef(oldBlob), { serialHex: "01ab", issuerSha256: "ff" });
    const blob = await signer.encryptCertRef({ serialHex: "02cd" });
    assert.deepEqual(await signer.decryptCertRef(blob), { serialHex: "02cd" });
    await rejectsCode(signer.decryptCertRef(Buffer.concat([blob.subarray(0, 40), Buffer.from("xx")])), "DECRYPT_FAILED");
    await rejectsCode(signer.personKey("not a tax code"), "BAD_REQUEST");
  });

  it("signs attest() and invalidate() on our contract only, value 0, our chain, under the caps", async () => {
    const raw = await signer.signTx(tx());
    const t = Transaction.from(raw);
    assert.equal(t.from, new Wallet(attesterKey).address);
    assert.equal(t.to, CONTRACT);
    assert.equal(Number(t.chainId), 4201);
    assert.equal(t.nonce, 7);
    await signer.signTx(tx({ data: IFACE.encodeFunctionData("invalidate", [UP, encodeBytes32String("INVALIDATED")]) }));
    for (const bad of [
      { to: Wallet.createRandom().address }, // another contract
      { data: IFACE.encodeFunctionData("setAttester", [UP]) }, // another function
      { data: "0x" }, // plain transfer
      { value: "1" },
      { chainId: 42 },
      { gasLimit: "1000001" },
      { maxFeePerGas: "100000000001" },
      { maxPriorityFeePerGas: "3000000000" }, // above maxFeePerGas
      { nonce: -1 },
      { gasLimit: "lots" },
    ]) {
      await rejectsCode(signer.signTx(tx(bad)), "TX_REFUSED");
    }
  });

  it("rate limits: mints per hour and per day, person keys per minute; a refusal does not count", async () => {
    let t = Date.parse("2026-10-27T00:00:00Z");
    const { signer: s, core } = testSigner({ contract: CONTRACT, chainId: 4201, clock: () => t, limits: { attestPerHour: 2, attestPerDay: 3, personKeyPerMinute: 2 } });
    await s.signTx(tx());
    await s.signTx(tx());
    await rejectsCode(s.signTx(tx()), "RATE_LIMITED");
    t += 3_600_001; // next hour
    await s.signTx(tx());
    await rejectsCode(s.signTx(tx()), "RATE_LIMITED"); // daily limit (3)
    t += 86_400_001;
    await s.signTx(tx());
    // invalidations have their own limit
    await s.signTx(tx({ data: IFACE.encodeFunctionData("invalidate", [UP, encodeBytes32String("X")]) }));
    await s.personKey("RSSMRA80A01H501X");
    await s.personKey("RSSMRA80A01H501X");
    await rejectsCode(s.personKey("RSSMRA80A01H501X"), "RATE_LIMITED");
    t += 60_001;
    await s.personKey("RSSMRA80A01H501X");
    const st = await core.handle({ op: "status" });
    assert.equal(st.refused.attest, 2);
    assert.equal(st.refused.personKey, 1);
    assert.equal(st.used.attestDay, 1);
  });

  it("refuses unknown operations", async () => {
    const { core } = testSigner();
    await rejectsCode(core.handle({ op: "export" }), "UNKNOWN_OP");
    await rejectsCode(core.handle({ op: "__proto__" }), "UNKNOWN_OP");
    await rejectsCode(core.handle(null), "UNKNOWN_OP");
  });

  describe("the program on its socket", () => {
    let dir, proc;
    before(async () => {
      dir = mkdtempSync(path.join(tmpdir(), "signer-sock-"));
      proc = await startSignerProcess(dir, { attesterKey, contract: CONTRACT, chainId: 4201, pepper, certRefKey, extraEnv: { SIGNER_MAX_ATTEST_PER_HOUR: "1" } });
    });
    after(() => {
      proc?.stop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it("answers over the socket, applies the limits from its env, logs no parameters", async () => {
      const s = createSigner(socketTransport(proc.socketPath));
      assert.equal((await s.hello()).address, new Wallet(attesterKey).address);
      assert.deepEqual(await s.personKey("RSSMRA80A01H501X"), await signer.personKey("RSSMRA80A01H501X"));
      await s.signTx(tx());
      await rejectsCode(s.signTx(tx()), "RATE_LIMITED");
      await new Promise((r) => setTimeout(r, 50));
      assert.match(proc.logs(), /signTx refused: RATE_LIMITED/);
      assert.ok(!proc.logs().includes("RSSMRA80A01H501X"));
    });

    it("answers garbage with BAD_REQUEST and drops an endless line", async () => {
      const exchange = (payload) =>
        new Promise((resolve) => {
          const sock = net.createConnection(proc.socketPath, () => sock.write(payload));
          let out = "";
          sock.on("data", (d) => (out += d));
          sock.on("close", () => resolve(out));
          sock.on("error", () => resolve(out));
          setTimeout(() => sock.destroy(), 500);
        });
      assert.match(await exchange("not json\n"), /"error":"BAD_REQUEST"/);
      assert.equal(await exchange("x".repeat(70 * 1024)), "");
    });
  });
});
