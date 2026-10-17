// UP CIE Link frontend: static ES modules, no third-party code, no build step.
// Routes: / · /collega · /verifica[/<up>] · /il-mio-bollino · /privacy · /note-legali
import { ApiError, api } from "./api.js";
import { fill, h, shortAddr, storage } from "./dom.js";
import { errorText, formatDate, getLang, setLang, t } from "./i18n.js";
import { WalletError, connectUp, extensionWallet, renounce, signStatement } from "./up.js";
import { viewAdmin } from "./admin.js";

const EXPLORERS = { 42: "https://explorer.execution.mainnet.lukso.network", 4201: "https://explorer.execution.testnet.lukso.network" };
const MAX_P7M_BYTES = 64 * 1024;
const POLL_MS = 2000;
const session = storage("session");
const prefs = storage("local");

const state = {
  config: null, // GET /api/config
  wallet: null, // connector { kind, request, ... }
  up: null, // connected UP address
};

// timers and pollers of the current page, cleared on navigation
let cleanups = [];
const onLeave = (fn) => cleanups.push(fn);
function leavePage() {
  for (const fn of cleanups) fn();
  cleanups = [];
}

const main = () => document.getElementById("main");
const isAddress = (a) => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
// a JavaScript error (not from the API or the wallet) is shown as JS_<name>
const codeOf = (e) => (e instanceof ApiError || e instanceof WalletError ? e.code : `JS_${e?.name ?? "Error"}`);
const notice = (kind, ...children) => h("div", { class: `notice ${kind}`, role: kind === "err" ? "alert" : "status" }, ...children);
const errorNotice = (e) => notice("err", errorText(codeOf(e)));
const explorerTx = (hash) => `${EXPLORERS[state.config?.chainId] ?? EXPLORERS[4201]}/tx/${hash}`;

// ------------------------------------------------------------------ chrome (header, footer, toggles)

function renderChrome() {
  document.documentElement.lang = getLang();
  document.title = t("title");
  const nav = document.getElementById("nav");
  const here = location.pathname;
  const link = (href, key) => h("a", { href, "data-link": true, class: here === href || (href !== "/" && here.startsWith(href)) ? "active" : null }, t(key));
  nav.replaceChildren(link("/collega", "navLink"), link("/verifica", "navVerify"), link("/il-mio-bollino", "navMine"));
  document.getElementById("langToggle").textContent = t("langButton");
  const light = document.documentElement.getAttribute("data-theme") === "light";
  const theme = document.getElementById("themeToggle");
  theme.textContent = light ? "☾" : "☀";
  theme.title = light ? t("themeToDark") : t("themeToLight");
  theme.setAttribute("aria-label", theme.title);
  document.getElementById("footer").replaceChildren(h("p", { html: t("footer") }), h("p", { class: "small" }, t("footerNote")));
}

function setupToggles() {
  document.getElementById("langToggle").addEventListener("click", () => {
    setLang(getLang() === "it" ? "en" : "it");
    render();
  });
  document.getElementById("themeToggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    prefs.set("ucl-theme", next);
    renderChrome();
  });
}

// ------------------------------------------------------------------ router

const routes = [
  [/^\/$/, viewHome],
  [/^\/collega\/?$/, viewLink],
  [/^\/verifica\/?$/, () => viewVerify(null)],
  [/^\/verifica\/(0x[0-9a-fA-F]{40})\/?$/, (m) => viewVerify(m[1])],
  [/^\/il-mio-bollino\/?$/, viewMine],
  [/^\/privacy\/?$/, () => viewStatic("privacyTitle", "privacy", t("privacySubtitle"))],
  [/^\/note-legali\/?$/, () => viewStatic("legalTitle", "legal")],
  // owner only, not in the menu: the backend checks the owner on-chain and the signed login
  [/^\/admin\/?$/, () => viewAdmin({ state, walletPanel, notice, errorNotice, explorerTx })],
];

export function navigate(path) {
  if (path !== location.pathname) history.pushState(null, "", path);
  render();
  window.scrollTo(0, 0);
}

function render() {
  leavePage();
  renderChrome();
  const root = main();
  root.replaceChildren();
  if (state.config?.network === "luksoTestnet") root.append(notice("warn", t("testnetBanner")));
  for (const [re, view] of routes) {
    const m = location.pathname.match(re);
    if (m) {
      root.append(view(m));
      return;
    }
  }
  root.append(viewHome());
}

document.addEventListener("click", (e) => {
  const a = e.target.closest?.("a[data-link]");
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
});
window.addEventListener("popstate", render);

// ------------------------------------------------------------------ pages

function viewHome() {
  return h(
    "div",
    {},
    h("img", { class: "banner", src: "/img/banner.png", alt: "", width: 1980, height: 840 }),
    h("h1", {}, t("homeTitle")),
    h("p", { class: "lead" }, t("homeLead")),
    h("div", { class: "actions" }, h("a", { class: "btn", href: "/collega", "data-link": true }, t("homeStart")), h("a", { class: "btn secondary", href: "/verifica", "data-link": true }, t("homeVerify"))),
    h("div", { class: "grid mt" },
      h("section", { class: "panel" }, h("h2", {}, t("howTitle")), h("div", { class: "text", html: t("how") })),
      h("section", { class: "panel" }, h("h2", {}, t("chainTitle")), h("div", { class: "text", html: t("chain") })),
      h("section", { class: "panel" }, h("h2", {}, t("needTitle")), h("div", { class: "text", html: t("need") })),
      h("section", { class: "panel" }, h("h2", {}, t("rulesTitle")), h("div", { class: "text", html: t("rules") })),
    ),
  );
}

function viewStatic(titleKey, bodyKey, subtitle) {
  return h("div", {}, h("h1", {}, t(titleKey)), subtitle ? h("p", { class: "lead" }, subtitle) : null, h("section", { class: "panel text", html: t(bodyKey) }));
}

/** Connection panel: one button per wallet. Calls onConnected(up) once the UP is known. */
function walletPanel(onConnected) {
  const box = h("div");
  const draw = (err) => {
    if (state.up) {
      box.replaceChildren(
        h("p", {}, `${t("connected")} `, h("code", { title: state.up }, state.up)),
      );
      return;
    }
    const ext = extensionWallet();
    const extButton = h("button", { type: "button", class: "btn", onclick: () => connect(ext) }, t("connectExtension"));
    fill(box,
      h("p", { class: "dim" }, t("connectText")),
      h("div", { class: "actions" },
        extButton,
        h("button", { type: "button", class: "btn secondary", disabled: true, title: t("androidSoon") }, t("connectAndroid")),
      ),
      ext ? null : notice("warn", h("span", { html: t("noExtension") })),
      h("p", { class: "small dim" }, t("androidSoon")),
      err ? errorNotice(err) : null,
    );
  };
  const connect = async (wallet) => {
    try {
      const up = await connectUp(wallet, state.config.chainId);
      state.wallet = wallet;
      state.up = up;
      wallet.onAccountsChanged?.(() => {
        state.up = null;
        state.wallet = null;
        render();
      });
      draw();
      onConnected(up);
    } catch (e) {
      draw(e);
    }
  };
  draw();
  if (state.up) queueMicrotask(() => onConnected(state.up));
  return box;
}

// ---------------------------------------------------------------- link flow

const STEPS = ["stepConnect", "stepMode", "stepConsent", "stepUpSign", "stepCie", "stepResult"];

function viewLink() {
  const root = h("div");
  const flow = { step: 0, mode: "link", statement: null };
  const stepsBar = () =>
    h("ol", { class: "steps", "aria-label": "steps" }, STEPS.map((k, i) => h("li", { class: i === flow.step ? "current" : i < flow.step ? "done" : null }, t(k))));

  const draw = (...content) => root.replaceChildren(h("h1", {}, t("linkTitle")), stepsBar(), ...content);

  // resume a statement of this browser session (reload during the CIE step or while waiting)
  const resumeId = session.get("ucl-statement");
  if (resumeId) {
    draw(h("p", {}, h("span", { class: "spinner" }), " ", t("loading")));
    api.statement(resumeId).then(
      (s) => {
        if (["pending_cie", "verifying", "queued", "minting", "done", "failed"].includes(s.status)) {
          flow.statement = s;
          return s.status === "pending_cie" ? stepCie() : stepWait();
        }
        session.del("ucl-statement");
        stepConnect();
      },
      () => {
        session.del("ucl-statement");
        stepConnect();
      },
    );
  } else {
    stepConnect();
  }
  return root;

  function stepConnect() {
    flow.step = 0;
    draw(h("section", { class: "panel" }, h("h2", {}, t("connectTitle")), walletPanel(() => stepMode())));
  }

  function stepMode() {
    flow.step = 1;
    const option = (value, titleKey, textKey) =>
      h("label", { class: "choice" },
        h("input", { type: "radio", name: "mode", value, checked: flow.mode === value, onchange: () => (flow.mode = value) }),
        h("strong", {}, t(titleKey)),
        h("div", { class: "small dim" }, t(textKey)),
      );
    draw(
      h("section", { class: "panel" }, h("h2", {}, t("connectTitle")), h("p", {}, `${t("connected")} `, h("code", {}, state.up))),
      h("section", { class: "panel" },
        h("h2", {}, t("modeTitle")),
        option("link", "modeLink", "modeLinkText"),
        option("migrate", "modeMigrate", "modeMigrateText"),
        option("additional", "modeAdditional", "modeAdditionalText"),
        h("div", { class: "actions" }, h("button", { type: "button", class: "btn", onclick: () => stepConsent() }, t("next"))),
      ),
    );
  }

  function stepConsent(err) {
    flow.step = 2;
    const read = h("input", { type: "checkbox", id: "consentRead" });
    const agree = h("input", { type: "checkbox", id: "consentAgree" });
    const go = h("button", { type: "button", class: "btn", disabled: true }, t("createButton"));
    const sync = () => (go.disabled = !(read.checked && agree.checked));
    read.addEventListener("change", sync);
    agree.addEventListener("change", sync);
    go.addEventListener("click", async () => {
      go.disabled = true;
      try {
        flow.statement = await api.createStatement(state.up, flow.mode);
        stepUpSign();
      } catch (e) {
        stepConsent(e);
      }
    });
    draw(
      h("section", { class: "panel" },
        h("h2", {}, t("consentTitle")),
        h("p", { class: "text", html: t("consentText") }),
        h("label", { class: "check" }, read, h("span", {}, t("consentRead"))),
        h("label", { class: "check" }, agree, h("span", {}, t("consentAgree"))),
        err ? errorNotice(err) : null,
        h("div", { class: "actions" }, h("button", { type: "button", class: "btn secondary", onclick: () => stepMode() }, t("back")), go),
      ),
    );
  }

  function stepUpSign(err) {
    flow.step = 3;
    const s = flow.statement;
    const sign = h("button", { type: "button", class: "btn" }, t("upSignButton"));
    sign.addEventListener("click", async () => {
      sign.disabled = true;
      try {
        const signature = await signStatement(state.wallet, state.up, s.text);
        flow.statement = { ...(await api.upSignature(s.id, signature)), text: s.text };
        session.set("ucl-statement", s.id);
        stepCie();
      } catch (e) {
        if (["UP_SIGNATURE_WINDOW_EXPIRED", "STATEMENT_EXPIRED"].includes(codeOf(e))) return expired();
        stepUpSign(e);
      }
    });
    draw(
      h("section", { class: "panel" },
        h("h2", {}, t("upSignTitle")),
        h("p", {}, t("upSignText")),
        h("pre", { class: "statement" }, s.text),
        h("p", {}, `${t("upSignDeadline")} `, countdown(s.upSignatureDeadline, expired)),
        err ? errorNotice(err) : null,
        h("div", { class: "actions" }, sign),
      ),
    );
  }

  function stepCie(err) {
    flow.step = 4;
    const s = flow.statement;
    const cades = state.config.cieChannels.includes("cades");
    const file = h("input", { type: "file", accept: ".p7m,application/pkcs7-mime", id: "p7m" });
    const send = h("button", { type: "button", class: "btn", disabled: true }, t("uploadButton"));
    const local = h("div");
    file.addEventListener("change", () => {
      local.replaceChildren();
      const f = file.files?.[0];
      send.disabled = !f;
      if (f && f.size > MAX_P7M_BYTES) {
        send.disabled = true;
        local.append(notice("err", t("fileTooBig")));
      }
    });
    send.addEventListener("click", async () => {
      send.disabled = true;
      try {
        const bytes = new Uint8Array(await file.files[0].arrayBuffer());
        flow.statement = await api.cieCades(s.id, bytes);
        stepWait();
      } catch (e) {
        if (codeOf(e) === "STATEMENT_EXPIRED") return expired();
        // a failed verification closes the statement: show the result page
        if (e instanceof ApiError && e.status !== 0 && e.status !== 429 && e.status < 500) {
          try {
            flow.statement = await api.statement(s.id);
            if (flow.statement.status === "failed") return stepResult();
          } catch { /* fall through */ }
        }
        stepCie(e);
      }
    });
    draw(
      h("section", { class: "panel" },
        h("h2", {}, t("cieTitle")),
        h("p", {}, `${t("cieDeadline")} `, countdown(s.expiresAt, expired)),
        cades
          ? h("div", {},
              h("div", { class: "text", html: t("cieSteps") }),
              h("div", { class: "actions" }, h("a", { class: "btn secondary", href: api.statementFileUrl(s.id), download: "" }, t("downloadButton"))),
              h("p", { class: "mt" }, h("label", { for: "p7m" }, h("strong", {}, t("chooseFile"))), h("br"), file),
              local,
              err ? errorNotice(err) : null,
              h("div", { class: "actions" }, send),
            )
          : notice("warn", t("cadesDisabled")),
      ),
    );
  }

  function stepWait() {
    flow.step = 5;
    const line = h("p", {}, h("span", { class: "spinner" }), " ", t("waitVerifying"));
    draw(h("section", { class: "panel" }, h("h2", {}, t("waitTitle")), line));
    let stop = false;
    onLeave(() => (stop = true));
    const tick = async () => {
      if (stop || !line.isConnected) return; // UCL-02: this step is no longer shown
      try {
        const s = await api.statement(flow.statement.id);
        if (!line.isConnected) return;
        flow.statement = { ...flow.statement, ...s };
        if (["done", "failed", "expired"].includes(s.status)) return stepResult();
        const key = { verifying: "waitVerifying", queued: "waitQueued", minting: "waitMinting" }[s.status] ?? "waitVerifying";
        line.replaceChildren(h("span", { class: "spinner" }), " ", t(key));
      } catch { /* transient: keep polling */ }
      setTimeout(tick, POLL_MS);
    };
    tick();
  }

  function stepResult() {
    flow.step = 5;
    session.del("ucl-statement");
    const s = flow.statement;
    const restart = h("div", { class: "actions" }, h("button", { type: "button", class: "btn secondary", onclick: () => navigate("/collega") }, t("restart")));
    if (s.status === "done") {
      return draw(
        h("section", { class: "panel" },
          h("h2", {}, t("stepResult")),
          notice("ok", h("strong", {}, t("doneTitle")), h("br"), t("doneText")),
          h("div", { class: "actions" },
            s.txHash ? h("a", { class: "btn secondary", href: explorerTx(s.txHash), target: "_blank", rel: "noopener" }, t("viewTx")) : null,
            h("a", { class: "btn", href: `/verifica/${s.up}`, "data-link": true }, t("viewBadge")),
          ),
        ),
      );
    }
    if (s.status === "expired") return expired();
    const ticket = s.exceptionTicket;
    draw(
      h("section", { class: "panel" },
        h("h2", {}, t("stepResult")),
        notice("err", h("strong", {}, t("failTitle")), h("br"), errorText(s.errorCode ?? "DEFAULT")),
        ticket ? ticketBox(ticket) : null,
        restart,
      ),
    );
  }

  function expired() {
    session.del("ucl-statement");
    flow.step = 5;
    draw(
      h("section", { class: "panel" },
        notice("warn", h("strong", {}, t("expiredTitle")), h("br"), t("expiredText")),
        h("div", { class: "actions" }, h("button", { type: "button", class: "btn", onclick: () => navigate("/collega") }, t("restart"))),
      ),
    );
  }
}

function ticketBox(ticket) {
  const btn = h("button", { type: "button", class: "btn secondary" }, t("copy"));
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(ticket);
      btn.textContent = t("copied");
    } catch { /* clipboard blocked: the code stays visible */ }
  });
  return h("div", { class: "notice" }, h("strong", {}, t("ticketTitle")), h("pre", { class: "statement", id: "ticket" }, ticket), h("p", { class: "small", html: t("ticketText") }), btn);
}

/**
 * Live countdown to an ISO date; calls onEnd once at zero.
 * UCL-02: it stops by itself as soon as its element leaves the page (another step was drawn), so the deadline of
 * an earlier step can never end a later one.
 */
function countdown(iso, onEnd) {
  const el = h("span", { class: "countdown" });
  const end = Date.parse(iso);
  const render = () => {
    const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
    el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    el.classList.toggle("low", left < 120);
    return left;
  };
  const timer = setInterval(() => {
    if (!el.isConnected) return clearInterval(timer);
    if (render() === 0) {
      clearInterval(timer);
      onEnd?.();
    }
  }, 1000);
  onLeave(() => clearInterval(timer));
  render();
  return el;
}

// ---------------------------------------------------------------- verify

function badgeCard(b) {
  const now = Date.now();
  const expired = b.status === "valid" && b.expiresAt && Date.parse(b.expiresAt) <= now;
  const [cls, key, textKey] =
    b.status === "valid" && !expired ? ["ok", "stateValid", null]
      : expired ? ["warn", "stateExpired", null]
      : b.status === "invalidated" ? ["warn", "stateInvalidated", "stateInvalidatedText"]
      : b.status === "revoked" ? ["err", "stateRevoked", "stateRevokedText"]
      : ["", "stateNone", "stateNoneText"];
  const shareUrl = `${location.origin}/verifica/${b.up}`;
  return h("section", { class: "panel", id: "badge" },
    h("span", { class: `status ${cls}`, id: "badgeState" }, t(key)),
    textKey ? h("p", { class: "dim" }, t(textKey)) : null,
    h("dl", { class: "facts" },
      h("dt", {}, t("factUp")), h("dd", {}, h("code", {}, b.up)),
      b.status !== "none" ? [
        h("dt", {}, t("factPrimary")), h("dd", {}, b.primary ? t("yes") : t("no")),
        h("dt", {}, t("factVerifiedAt")), h("dd", {}, formatDate(b.verifiedAt)),
        h("dt", {}, t("factExpiresAt")), h("dd", {}, formatDate(b.expiresAt)),
      ] : null,
    ),
    h("p", { class: "small dim" }, `${t("shareLink")} `, h("a", { href: `/verifica/${b.up}`, "data-link": true }, shareUrl)),
  );
}

function viewVerify(initial) {
  const input = h("input", { type: "text", placeholder: t("verifyPlaceholder"), value: initial ?? "", spellcheck: "false", autocomplete: "off", "aria-label": t("verifyPlaceholder") });
  const out = h("div");
  const check = async (addr) => {
    if (!isAddress(addr)) return out.replaceChildren(notice("err", t("invalidAddress")));
    out.replaceChildren(h("p", {}, h("span", { class: "spinner" }), " ", t("loading")));
    try {
      out.replaceChildren(badgeCard(await api.badge(addr)));
    } catch (e) {
      out.replaceChildren(errorNotice(e));
    }
  };
  const form = h("form", { class: "panel", onsubmit: (e) => {
    e.preventDefault();
    const a = input.value.trim();
    if (isAddress(a) && location.pathname !== `/verifica/${a}`) history.replaceState(null, "", `/verifica/${a}`);
    check(a);
  } }, input, h("div", { class: "actions" }, h("button", { type: "submit", class: "btn" }, t("verifyButton"))));
  if (initial) check(initial);
  return h("div", {}, h("h1", {}, t("verifyTitle")), h("p", { class: "lead" }, t("verifyLead")), form, out);
}

// ---------------------------------------------------------------- my badge

function viewMine() {
  const out = h("div");
  const show = async (up, sentTx) => {
    out.replaceChildren(h("p", {}, h("span", { class: "spinner" }), " ", t("loading")));
    let b;
    try {
      b = await api.badge(up);
      // after a renunciation the backend's short cache may still answer "valid": re-read for up to 30 s
      for (let i = 0; sentTx && b.status === "valid" && i < 10 && out.isConnected; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        b = await api.badge(up);
      }
    } catch (e) {
      return out.replaceChildren(errorNotice(e));
    }
    const valid = b.status === "valid";
    const actions = h("div", { class: "actions" },
      h("a", { class: "btn", href: "/collega", "data-link": true }, b.status === "none" ? t("linkButton") : t("renewButton")),
    );
    const parts = [badgeCard(b), actions];
    if (sentTx) parts.push(notice("ok", t("renounceSent"), " ", h("a", { href: explorerTx(sentTx), target: "_blank", rel: "noopener" }, t("viewTx"))));
    if (valid) parts.push(renouncePanel(up, (tx) => show(up, tx)));
    parts.push(dataPanel(up));
    out.replaceChildren(...parts);
  };
  return h("div", {},
    h("h1", {}, t("mineTitle")),
    h("p", { class: "lead" }, t("mineLead")),
    h("section", { class: "panel" }, walletPanel((up) => show(up))),
    out,
  );
}

function renouncePanel(up, done) {
  const errBox = h("div");
  const btn = h("button", { type: "button", class: "btn danger" }, t("renounceButton"));
  btn.addEventListener("click", async () => {
    if (!window.confirm(t("renounceConfirm"))) return;
    btn.disabled = true;
    errBox.replaceChildren();
    try {
      const tx = await renounce(state.wallet, up, state.config.contract);
      done(tx);
    } catch (e) {
      btn.disabled = false;
      errBox.replaceChildren(errorNotice(e));
    }
  });
  return h("section", { class: "panel" }, h("h2", {}, t("renounceTitle")), h("p", {}, t("renounceText")), errBox, btn);
}

// UCL-31: export / erasure of the data kept about the person, asked by signing with the UP
function dataPanel(up) {
  const result = h("div");
  const run = async (action, btn) => {
    if (action === "erase" && !window.confirm(t("dataEraseConfirm"))) return;
    btn.disabled = true;
    result.replaceChildren();
    try {
      const c = await api.subjectChallenge(up, action);
      const signature = await signStatement(state.wallet, up, c.text);
      const r = await api.subjectRequest(c.text, c.tag, signature);
      if (action === "export") {
        const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" }));
        const a = h("a", { href: url, download: `up-cie-link-data-${up.slice(2, 10)}.json` }, t("dataDownload"));
        result.replaceChildren(notice("ok", t("dataExportReady"), " ", a));
        a.click();
        onLeave(() => URL.revokeObjectURL(url));
      } else {
        result.replaceChildren(notice("ok", t("dataErased").replace("{n}", String(r.ups.length))));
      }
    } catch (e) {
      result.replaceChildren(codeOf(e) === "NO_DATA" ? notice("ok", t("dataNone")) : errorNotice(e));
    } finally {
      btn.disabled = false;
    }
  };
  const exportBtn = h("button", { type: "button", class: "btn secondary" }, t("dataExportButton"));
  const eraseBtn = h("button", { type: "button", class: "btn danger" }, t("dataEraseButton"));
  exportBtn.addEventListener("click", () => run("export", exportBtn));
  eraseBtn.addEventListener("click", () => run("erase", eraseBtn));
  return h("section", { class: "panel" },
    h("h2", {}, t("dataTitle")),
    h("p", {}, t("dataText")),
    result,
    h("div", { class: "actions" }, exportBtn, eraseBtn),
  );
}

// ---------------------------------------------------------------- start

async function start() {
  setupToggles();
  setLang(getLang());
  renderChrome();
  main().replaceChildren(h("p", {}, h("span", { class: "spinner" }), " ", t("loading")));
  try {
    state.config = await api.config();
  } catch {
    main().replaceChildren(notice("err", t("configError")));
    return;
  }
  render();
}

start();
