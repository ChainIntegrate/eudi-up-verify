// Frontend end-to-end in a real browser (Playwright + Chromium, when installed):
// local chain + UpCieBadge + real LSP0 UP, the real backend process, a fake CIE PKI with an HTTP OCSP responder,
// the static frontend served with the same Content-Security-Policy as nginx, and a stub of the UP Browser
// Extension (window.lukso) whose signatures and transactions come from the UP's real controller key.
// Flow: link (UP signature, statement download, .p7m upload, mint) → verify page → renounce, export and erase from "my badge".
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
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss://relay.walletconnect.org; " +
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
        headers: {
          "content-type": req.headers["content-type"] ?? "application/octet-stream",
          ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
          ...(req.headers.origin ? { origin: req.headers.origin } : {}),
        },
        body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const headers = {};
      for (const k of ["content-type", "content-disposition", "set-cookie"]) if (r.headers.get(k)) headers[k] = r.headers.get(k);
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

/**
 * Stand-in for vendor/signclient-*.js (Reown's relay is not reachable from the tests): the page's WalletConnect code
 * runs unchanged against it. window.__wcApprove(up, chainId) plays UP Wallet approving the pairing; requests go to
 * the same controller key as the extension stub. Sessions are kept in localStorage, as the real client does.
 */
function fakeSignClientBundle() {
  const KEY = "fake-wc-sessions";
  const load = () => JSON.parse(localStorage.getItem(KEY) ?? "[]");
  const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));
  const handlers = {};
  const client = {
    core: { relayer: { connected: true, restartTransport: async () => {} }, pairing: { disconnect: async () => {} } },
    session: { getAll: () => load() },
    on: (ev, cb) => ((handlers[ev] ??= []).push(cb)),
    async connect({ optionalNamespaces }) {
      window.__wcNamespaces = optionalNamespaces;
      let approve;
      const approval = new Promise((r) => (approve = r));
      window.__wcApprove = (up, chainId) => {
        const s = { topic: "topic-1", pairingTopic: "pair-1", expiry: Math.floor(Date.now() / 1000) + 3600, peer: { metadata: { name: "ChainIntegrate UP Wallet" } }, namespaces: { eip155: { accounts: [`eip155:${chainId}:${up}`] } } };
        save([s]);
        approve(s);
      };
      return { uri: "wc:pair-1@2?relay-protocol=irn&symKey=00", approval: () => approval };
    },
    request: async ({ request }) => window.__walletRequest(request.method, request.params ?? []),
    async disconnect({ topic }) {
      save(load().filter((s) => s.topic !== topic));
      window.__wcDisconnected = true;
    },
  };
  window.SignClientBundle = {
    Core: class { constructor(opts) { window.__wcCore = opts; this.eventClient = {}; } },
    SignClient: { init: async () => client },
    getSdkError: (k) => ({ code: 6000, message: k }),
  };
}

describe("frontend end-to-end in Chromium", { skip: (!contractsAvailable && "contracts not built") || (!browserAvailable && "playwright not installed") }, () => {
  let node, pki, stopOcsp, server, web, dir, site, up, profile, controller, ownerProfile, ownerController, badgeAddress, oldBadgeAddress, browser, logs = "";

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
    ownerController = new NonceManager(new Wallet(node.keys[2], node.provider));
    ownerProfile = await deployProfile(deployer, ownerController);
    const ownerUp = ownerProfile.up;
    profile = await deployProfile(deployer, controller);
    up = profile.up;
    const b = artifact("badge");
    const badge = await new ContractFactory(b.abi, b.bytecode, deployer).deploy(ownerUp, new Wallet(attesterKey).address);
    await badge.waitForDeployment();
    badgeAddress = await badge.getAddress();
    // UCL-38: an earlier contract of the same network, still with the live attester
    const oldBadge = await new ContractFactory(b.abi, b.bytecode, deployer).deploy(ownerUp, new Wallet(attesterKey).address);
    await oldBadge.waitForDeployment();
    oldBadgeAddress = await oldBadge.getAddress();
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
    writeFileSync(path.join(dir, "deployments", "luksoTestnet.json"), JSON.stringify({ chainId: 4201, address: badgeAddress, deployBlock, superseded: [{ address: oldBadgeAddress }] }));
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
      WALLETCONNECT_PROJECT_ID: "test-project-id",
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
  async function newPage(who = { up: () => up, profile: () => profile, controller: () => controller }, { extension = true, upWallet = false } = {}) {
    const page = await browser.newPage({ acceptDownloads: true });
    const problems = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));
    await page.exposeFunction("__walletRequest", async (method, params) => {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [who.up()];
        case "eth_chainId":
          return "0x1069";
        case "personal_sign": {
          assert.equal(params[1], who.up());
          return who.controller().signMessage(getBytes(params[0]));
        }
        case "eth_sendTransaction": {
          const [tx] = params;
          assert.equal(tx.from, who.up());
          const receipt = await who.profile().execute(tx.to, tx.data);
          return receipt.hash;
        }
        default:
          throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
      }
    });
    if (extension) {
      await page.addInitScript(() => {
        window.lukso = { request: ({ method, params }) => window.__walletRequest(method, params ?? []), on() {} };
      });
    }
    if (upWallet) await page.addInitScript(fakeSignClientBundle);
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
    await page.getByRole("button", { name: "Estensione UP Browser" }).waitFor();
    assert.ok(!/\bnull\b|\bundefined\b/.test(await page.locator("main").innerText()), "no stray null/undefined in the connect panel");
    await page.getByRole("button", { name: "Estensione UP Browser" }).click();
    await shot(page, "03-mode");
    await page.getByRole("button", { name: "Avanti" }).click();
    const create = page.getByRole("button", { name: "Prepara l'enunciato" });
    await create.waitFor();
    assert.equal(await page.locator(".notice.err").count(), 0, "no error notice on the consent step");
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

    // UCL-31: data export and erasure, signed by the UP
    const [dataFile] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Scarica i miei dati" }).click()]);
    const exported = JSON.parse(readFileSync(await dataFile.path(), "utf8"));
    assert.deepEqual(exported.links.map((l) => l.up), [up]); // status: "valid" until the indexer sees the renunciation
    await page.getByText("Ecco i tuoi dati.").waitFor();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Cancella i miei dati" }).click();
    await page.getByText("Dati cancellati (1 UP).").waitFor();
    await page.getByRole("button", { name: "Scarica i miei dati" }).click();
    await page.getByText("Non conserviamo dati collegati a questa UP.").waitFor();

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
    assert.ok(!logs.includes("RSSMRA80A01H501X"));
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

  it("admin: only the owner logs in; status, exception, revoke/reinstate, metadata, emergency stop", async () => {
    // a holder UP is refused
    const holder = await newPage();
    await holder.page.goto(site + "/admin");
    await holder.page.getByRole("button", { name: "Estensione UP Browser" }).click();
    await holder.page.getByRole("button", { name: "Accedi come owner" }).click();
    await holder.page.getByText("Questa UP non è l'owner del contratto").waitFor();
    await holder.page.close();

    const owner = { up: () => ownerProfile.up, profile: () => ownerProfile, controller: () => ownerController };
    const { page, problems } = await newPage(owner);
    page.on("dialog", (d) => d.accept());
    const badge = new Contract(badgeAddress, artifact("badge").abi, node.provider);

    // an exception request in the backend database (as created by a second link of the same person)
    const Database = (await import("better-sqlite3")).default;
    const ticket = `0x${"5a".repeat(32)}`;
    const sql = new Database(path.join(dir, "fe2e.db"));
    sql.prepare("INSERT OR IGNORE INTO persons (person_key, created_at) VALUES (?, ?)").run(Buffer.alloc(32, 9), Date.now());
    sql.prepare("INSERT INTO exception_requests (ticket, person_key, status, created_at) VALUES (?, ?, 'pending', ?)").run(ticket, Buffer.alloc(32, 9), Date.now());
    sql.close();

    await page.goto(site + "/admin");
    assert.ok(await page.getByText("TESTNET", { exact: true }).isVisible());
    await page.getByRole("button", { name: "Estensione UP Browser" }).click();
    await page.getByRole("button", { name: "Accedi come owner" }).click();
    await page.getByText("Stato del servizio").waitFor();
    assert.equal(await page.locator('[data-fact="adminOwner"]').textContent(), ownerProfile.up);
    await shot(page, "10-admin");

    // approve the exception for 3 UPs
    const row = page.locator(`[data-ticket="${ticket}"]`);
    await row.locator("input").fill("3");
    await row.getByRole("button", { name: "Approva" }).click();
    await row.getByText("Transazione inviata.").waitFor({ timeout: 30_000 });
    assert.equal(Number(await badge.exceptionOf(ticket)), 3);

    // revoke and reinstate the holder's UP
    await page.fill("#adminUp", up);
    await page.getByRole("button", { name: "Cerca" }).click();
    await page.locator("#adminRevoke").click();
    await page.locator("#adminReinstate").waitFor({ timeout: 30_000 });
    assert.equal(Number((await badge.getAttestation(up)).status), 3);
    await page.locator("#adminReinstate").click();
    await page.locator("#adminRevoke").waitFor({ timeout: 30_000 });
    assert.equal(Number((await badge.getAttestation(up)).status), 2);

    // metadata: not set yet -> update -> up to date
    assert.equal(await page.locator("#adminMetadataState").textContent(), "da aggiornare");
    await page.locator("#adminSetMetadata").click();
    await page.waitForFunction(() => document.querySelector("#adminMetadataState")?.textContent === "aggiornati", null, { timeout: 30_000 });

    // emergency stop and restore
    await page.locator("#adminStop").click();
    await page.locator("#adminStopped").waitFor({ timeout: 30_000 });
    assert.equal(await badge.attester(), "0x0000000000000000000000000000000000000000");
    await page.locator("#adminRestore").click();
    await page.locator("#adminStop").waitFor({ timeout: 30_000 });
    assert.notEqual(await badge.attester(), "0x0000000000000000000000000000000000000000");

    // UCL-38: the superseded contract gets its attester set to zero
    await page.locator(`[data-superseded="${oldBadgeAddress}"]`).click();
    await page.getByText("attestatore a zero", { exact: true }).waitFor({ timeout: 30_000 });
    assert.equal(await new Contract(oldBadgeAddress, ["function attester() view returns (address)"], node.provider).attester(), "0x0000000000000000000000000000000000000000");

    // every action is in the audit log
    const db = new Database(path.join(dir, "fe2e.db"), { readonly: true });
    const events = db.prepare("SELECT event FROM audit WHERE event LIKE 'admin_%' ORDER BY id").all().map((r) => r.event);
    db.close();
    assert.ok(!/\bnull\b|\bundefined\b/.test(await page.locator("main").innerText()), "no stray null/undefined in the page");
    assert.deepEqual(events, ["admin_login", "admin_approveException", "admin_revoke", "admin_reinstate", "admin_setMetadata", "admin_stopMinting", "admin_restoreAttester", "admin_stopSuperseded"]);
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
  it("UP Wallet for Android (WalletConnect): pair with the QR code, sign, kept after reload, disconnect", async () => {
    const { page, problems } = await newPage(undefined, { extension: false, upWallet: true });
    await page.goto(site + "/collega");
    await page.locator("#connectUpWallet").click();
    await page.locator("#wcQr").waitFor(); // the real QR library, loaded with Subresource Integrity
    assert.match(await page.locator("#wcQr").getAttribute("src"), /^data:image\/gif;base64,/);
    assert.equal(await page.locator("#wcOpen").getAttribute("href"), "wc:pair-1@2?relay-protocol=irn&symKey=00");
    assert.deepEqual(await page.evaluate(() => window.__wcNamespaces), {
      eip155: { chains: ["eip155:4201"], methods: ["personal_sign", "eth_sendTransaction"], events: ["accountsChanged", "chainChanged"] },
    });
    assert.deepEqual(await page.evaluate(() => [window.__wcCore.telemetryEnabled, window.__wcCore.customStoragePrefix]), [false, "up-cie-link"]);
    await shot(page, "11-upwallet-pair");
    await page.evaluate((a) => window.__wcApprove(a, 4201), up);

    // the link flow goes on as with the extension; the statement is signed in "UP Wallet"
    await page.getByRole("button", { name: "Avanti" }).click();
    await page.check("#consentRead");
    await page.check("#consentAgree");
    await page.getByRole("button", { name: "Prepara l'enunciato" }).click();
    const text = await page.locator("pre.statement").textContent();
    await page.getByRole("button", { name: "Firma con la UP" }).click();
    await page.locator("#p7m").waitFor();
    await page.setInputFiles("#p7m", { name: "s.p7m", mimeType: "application/pkcs7-mime", buffer: pki.signCades(Buffer.from(text, "ascii")) });
    await page.getByRole("button", { name: "Invia il file firmato" }).click();
    await page.getByText("Fatto: la UP ha il bollino").waitFor({ timeout: 30_000 });

    // the session is kept: after a reload "My badge" is connected without pairing again
    await page.goto(site + "/il-mio-bollino");
    await page.getByText("con UP Wallet").waitFor();
    assert.equal(await page.locator("#badgeState").textContent(), "Bollino valido");
    // the admin page offers the extension only (desktop only)
    await page.goto(site + "/admin");
    await page.getByText("La pagina admin si usa solo dal computer").waitFor();
    assert.equal(await page.locator("#connectUpWallet").count(), 0);
    // disconnect
    await page.goto(site + "/il-mio-bollino");
    await page.locator("#wcDisconnect").click();
    await page.locator("#connectUpWallet").waitFor();
    assert.equal(await page.evaluate(() => [window.__wcDisconnected, localStorage.getItem("ucl-wc-session")]).then((r) => JSON.stringify(r)), "[true,null]");
    assert.deepEqual(problems, []);
  });
});
