// Frontend end-to-end in a real browser (Playwright + Chromium, when installed):
// local chain + UpCieBadge + real LSP0 UP, the real backend process, a fake CIE PKI with an HTTP OCSP responder,
// the static frontend served with the same Content-Security-Policy as nginx, and a stub of the UP Browser
// Extension (window.lukso) whose signatures and transactions come from the UP's real controller key.
// Flow: link (UP signature, statement download, .p7m upload, mint) → verify page → renounce from "my badge".
import assert from "node:assert/strict";
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { Contract, ContractFactory, Interface, NonceManager, Wallet, getBytes, hexlify, id, randomBytes } from "ethers";
import { createFakePki } from "./helpers/fake-pki.js";
import { artifact, contractsAvailable, deployProfile, startNode } from "./helpers/hardhat-node.js";

const FRONTEND = fileURLToPath(new URL("../../frontend/", import.meta.url));
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function loadPlaywright() {
  try {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    return createRequire(path.join(root, "noop.js"))("playwright");
  } catch {
    return null;
  }
}
const playwright = loadPlaywright();
const browserAvailable = !!playwright && existsSync("/opt/pw-browsers");
// optional: SCREENSHOTS_DIR=<dir> saves screenshots of the main steps (for review, not asserted)
const SHOTS = process.env.SCREENSHOTS_DIR;
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml" };

/** Static frontend with SPA fallback and the nginx CSP; /api is proxied to the backend. */
function serveFrontend(port, apiBase) {
  const srv = createHttpServer(async (req, res) => {
    if (req.url.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await fetch(apiBase + req.url, {
        method: req.method,
        headers: { "content-type": req.headers["content-type"] ?? "application/octet-stream" },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const headers = {};
      for (const k of ["content-type", "content-disposition"]) if (r.headers.get(k)) headers[k] = r.headers.get(k);
      res.writeHead(r.status, headers);
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(FRONTEND, rel);
    if (!file.startsWith(FRONTEND) || !existsSync(file) || rel.endsWith("/")) file = path.join(FRONTEND, "index.html");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "content-security-policy": CSP });
    res.end(readFileSync(file));
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}

describe("frontend end-to-end in Chromium", { skip: (!contractsAvailable && "contracts not built") || (!browserAvailable && "playwright not installed") }, () => {
  let node, pki, stopOcsp, server, web, dir, site, up, profile, controller, badgeAddress, browser, logs = "";

  before(async () => {
    node = await startNode({ chainId: 4201 });
    const [deployer] = node.wallets;
    const attesterKey = node.keys[1];
    controller = new NonceManager(new Wallet(node.keys[3], node.provider)); // funded: it also sends renounce()
    const upArt = artifact("universalProfile");
    const deployUp = async (ownerAddr) => {
      const c = await new ContractFactory(upArt.abi, upArt.bytecode, deployer).deploy(ownerAddr);
      await c.waitForDeployment();
      return c.getAddress();
    };
    const ownerUp = await deployUp(Wallet.createRandom().address);
    profile = await deployProfile(deployer, controller);
    up = profile.up;
    const b = artifact("badge");
    const badge = await new ContractFactory(b.abi, b.bytecode, deployer).deploy(ownerUp, new Wallet(attesterKey).address);
    await badge.waitForDeployment();
    badgeAddress = await badge.getAddress();
    const deployBlock = await node.provider.getBlockNumber();
    // the selector hard-coded in the frontend matches the contract
    assert.ok(new Interface(b.abi).getFunction("renounce"));
    assert.ok(readFileSync(path.join(FRONTEND, "js/up.js"), "utf8").includes(`RENOUNCE_SELECTOR = "${id("renounce()").slice(0, 10)}"`));

    const ocspPort = await freePort();
    pki = createFakePki({ ocspUrl: `http://127.0.0.1:${ocspPort}/` });
    stopOcsp = pki.serveOcsp(ocspPort);

    dir = mkdtempSync(path.join(tmpdir(), "fe2e-"));
    mkdirSync(path.join(dir, "deployments"));
    mkdirSync(path.join(dir, "trust"));
    writeFileSync(path.join(dir, "deployments", "luksoTestnet.json"), JSON.stringify({ chainId: 4201, address: badgeAddress, deployBlock }));
    writeFileSync(path.join(dir, "trust", "root.pem"), pki.rootPem);
    writeFileSync(path.join(dir, "trust", "sub.pem"), pki.subPem);

    const apiPort = await freePort();
    const webPort = await freePort();
    site = `http://127.0.0.1:${webPort}`;
    const env = {
      ...process.env,
      NETWORK: "luksoTestnet",
      RPC_URL: node.url,
      PORT: String(apiPort),
      PUBLIC_ORIGIN: site,
      DB_PATH: path.join(dir, "fe2e.db"),
      DEPLOYMENTS_DIR: path.join(dir, "deployments"),
      ATTESTER_PRIVATE_KEY: attesterKey,
      UNIQ_PEPPER: hexlify(randomBytes(32)),
      CERT_REF_KEY: hexlify(randomBytes(32)),
      TRUST_DIR: path.join(dir, "trust"),
      CIE_ROOT_SHA256: pki.rootSha256,
      ALLOW_CADES_UPLOAD: "true",
    };
    server = spawn(process.execPath, [fileURLToPath(new URL("../src/server.js", import.meta.url))], { env, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", (d) => (logs += d));
    server.stderr.on("data", (d) => (logs += d));
    for (let i = 0; i < 100 && !logs.includes("trust store:"); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(logs.includes("trust store:"), `server did not start:\n${logs}`);
    web = await serveFrontend(webPort, `http://127.0.0.1:${apiPort}`);
    browser = await playwright.chromium.launch();
  });

  after(async () => {
    await browser?.close();
    web?.close();
    server?.kill("SIGTERM");
    stopOcsp?.();
    node?.stop();
    pki?.cleanup();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** A page with the UP Browser Extension stub, backed by the controller key in Node. */
  async function newPage() {
    const page = await browser.newPage({ acceptDownloads: true });
    const problems = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));
    await page.exposeFunction("__walletRequest", async (method, params) => {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [up];
        case "eth_chainId":
          return "0x1069";
        case "personal_sign": {
          assert.equal(params[1], up);
          return controller.signMessage(getBytes(params[0]));
        }
        case "eth_sendTransaction": {
          const [tx] = params;
          assert.equal(tx.from, up);
          const receipt = await profile.execute(tx.to, tx.data);
          return receipt.hash;
        }
        default:
          throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
      }
    });
    await page.addInitScript(() => {
      window.lukso = { request: ({ method, params }) => window.__walletRequest(method, params ?? []), on() {} };
    });
    return { page, problems };
  }

  it("links, verifies and renounces through the pages", async () => {
    const { page, problems } = await newPage();
    await page.goto(site + "/");
    await page.getByRole("heading", { level: 1 }).waitFor();
    assert.equal(await page.locator("h1").textContent(), "Collega la tua Universal Profile alla tua CIE");
    await shot(page, "01-home-dark");
    assert.ok(await page.getByText("Rete di prova").isVisible());

    // language and theme toggles
    await page.click("#langToggle");
    assert.equal(await page.locator("h1").textContent(), "Link your Universal Profile to your CIE");
    assert.equal(await page.getAttribute("html", "lang"), "en");
    await page.click("#langToggle");
    assert.equal(await page.getAttribute("html", "data-theme"), "dark");
    await page.click("#themeToggle");
    assert.equal(await page.getAttribute("html", "data-theme"), "light");
    await page.reload();
    assert.equal(await page.getAttribute("html", "data-theme"), "light", "theme kept after reload");
    await shot(page, "02-home-light");

    // link flow
    await page.getByRole("link", { name: "Collega la UP" }).click();
    await page.getByRole("button", { name: "Estensione UP Browser" }).click();
    await shot(page, "03-mode");
    await page.getByRole("button", { name: "Avanti" }).click();
    const create = page.getByRole("button", { name: "Prepara l'enunciato" });
    assert.equal(await create.isDisabled(), true, "consent is required");
    await page.check("#consentRead");
    assert.equal(await create.isDisabled(), true);
    await page.check("#consentAgree");
    await create.click();
    const text = await page.locator("pre.statement").textContent();
    assert.ok(text.includes(`Universal-Profile: ${up}`));
    await shot(page, "04-up-sign");
    await page.getByRole("button", { name: "Firma con la UP" }).click();
    await page.locator("#p7m").waitFor();
    await shot(page, "05-cie");

    // CIE step: the downloaded file has exactly the statement bytes; "CieSign" signs it
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Scarica l'enunciato" }).click()]);
    const file = readFileSync(await download.path());
    assert.equal(file.toString("ascii"), text);
    assert.match(download.suggestedFilename(), /^up-cie-link-[0-9a-f]{8}\.txt$/);
    await page.setInputFiles("#p7m", { name: "enunciato.txt.p7m", mimeType: "application/pkcs7-mime", buffer: pki.signCades(file) });
    await page.getByRole("button", { name: "Invia il file firmato" }).click();
    await page.getByText("Fatto: la UP ha il bollino").waitFor({ timeout: 30_000 });
    await shot(page, "06-done");

    // verify page
    await page.getByRole("link", { name: "Vedi il bollino" }).click();
    await page.locator("#badgeState").waitFor();
    assert.equal(await page.locator("#badgeState").textContent(), "Bollino valido");
    assert.equal(new URL(page.url()).pathname, `/verifica/${up}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await shot(page, "07-verify-mobile");
    await page.setViewportSize({ width: 1280, height: 720 });

    // invalid address
    await page.fill("input[type=text]", "0x123");
    await page.getByRole("button", { name: "Verifica" }).click();
    await page.getByText("Indirizzo non valido.").waitFor();

    // my badge: renounce through the UP
    await page.getByRole("link", { name: "Il mio bollino" }).click();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Rinuncia" }).click();
    await page.getByText("Transazione inviata.").waitFor({ timeout: 30_000 });
    assert.equal(await page.locator("#badgeState").textContent(), "Bollino invalidato");
    await shot(page, "08-mine-renounced");

    // a direct visit to a deep link works (SPA fallback) and shows the same state
    await page.goto(`${site}/verifica/${up}`);
    await page.locator("#badgeState").waitFor();
    assert.equal(await page.locator("#badgeState").textContent(), "Bollino invalidato");

    assert.deepEqual(problems, [], "no page errors and no CSP violations");
    // the CSP is really enforced (so the check above means something)
    const blocked = await page.evaluate(() => {
      const s = document.createElement("script");
      s.textContent = "window.__inline = 1";
      document.head.append(s);
      return window.__inline === undefined;
    });
    assert.equal(blocked, true);
    assert.ok(!logs.includes("RSSMRA80A01H501U"));
  });

  it("UCL-02: earlier deadlines do not end later steps (fake clock)", async () => {
    const { page, problems } = await newPage();
    await page.clock.install({ time: new Date() });
    await page.goto(site + "/collega");
    await page.getByRole("button", { name: "Estensione UP Browser" }).click();
    await page.getByRole("button", { name: "Avanti" }).click();
    await page.check("#consentRead");
    await page.check("#consentAgree");
    await page.getByRole("button", { name: "Prepara l'enunciato" }).click();
    const text = await page.locator("pre.statement").textContent();
    await page.getByRole("button", { name: "Firma con la UP" }).click();
    await page.locator("#p7m").waitFor();

    // past the 5-minute UP deadline: the CIE step stays (the backend still accepts the file)
    await page.clock.fastForward("05:10");
    assert.equal(await page.getByText("Enunciato scaduto").isVisible(), false);
    assert.equal(await page.locator("#p7m").isVisible(), true);

    await page.setInputFiles("#p7m", { name: "s.p7m", mimeType: "application/pkcs7-mime", buffer: pki.signCades(Buffer.from(text, "ascii")) });
    await page.getByRole("button", { name: "Invia il file firmato" }).click();
    await page.getByText("Fatto: la UP ha il bollino").waitFor({ timeout: 30_000 });

    // past the 15-minute statement expiry: the result stays
    await page.clock.fastForward("10:00");
    assert.equal(await page.getByText("Fatto: la UP ha il bollino").isVisible(), true);
    assert.equal(await page.getByText("Enunciato scaduto").isVisible(), false);
    assert.deepEqual(problems, []);
  });

  it("shows clear errors: no extension, wrong file", async () => {
    // without the extension
    const plain = await browser.newPage();
    await plain.goto(site + "/collega");
    await plain.getByText("Estensione UP Browser non trovata").waitFor();
    await plain.close();

    // a .p7m over another text is refused and explained
    const { page, problems } = await newPage();
    await page.goto(site + "/collega");
    await page.getByRole("button", { name: "Estensione UP Browser" }).click();
    await page.getByRole("button", { name: "Avanti" }).click();
    await page.check("#consentRead");
    await page.check("#consentAgree");
    await page.getByRole("button", { name: "Prepara l'enunciato" }).click();
    await page.getByRole("button", { name: "Firma con la UP" }).click();
    await page.locator("#p7m").waitFor();
    await page.setInputFiles("#p7m", { name: "x.p7m", mimeType: "application/pkcs7-mime", buffer: pki.signCades(Buffer.from("another text")) });
    await page.getByRole("button", { name: "Invia il file firmato" }).click();
    await page.getByText("Collegamento non riuscito").waitFor({ timeout: 30_000 });
    assert.ok(await page.getByText("Il file firmato non contiene esattamente l'enunciato").isVisible());
    await shot(page, "09-error");
    assert.deepEqual(problems, []);
  });
});
