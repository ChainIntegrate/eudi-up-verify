// Admin page (/admin), for the contract owner only (decisions A1-A5, docs/03-frontend.md §6).
// The backend checks the owner on-chain and the signed login; this page never decides who is allowed.
// Every transaction is prepared by the backend (calldata), shown, confirmed (MAINNET typed on mainnet) and sent by
// the owner UP through the wallet; then it is logged (audit + e-mail).
import { ApiError, api } from "./api.js";
import { fill, h } from "./dom.js";
import { errorText, formatDate, t } from "./i18n.js";
import { WalletError, sendFromUp, signStatement } from "./up.js";

const codeOf = (e) => (e instanceof ApiError || e instanceof WalletError ? e.code : `JS_${e?.name ?? "Error"}`);

/** @param ctx {{state, walletPanel, notice, errorNotice, explorerTx}} */
export function viewAdmin(ctx) {
  const { state, walletPanel, notice, errorNotice, explorerTx } = ctx;
  const root = h("div");
  const body = h("div");
  const net = state.config?.network === "luksoMainnet"
    ? notice("err", h("strong", {}, "MAINNET"), " — ", t("adminMainnetBanner"))
    : notice("warn", h("strong", {}, "TESTNET"), " — ", t("adminTestnetBanner"));
  root.append(h("h1", {}, t("adminTitle")), net, h("section", { class: "panel" }, walletPanel(() => checkSession(), { upWallet: false })), body);
  return root;

  async function checkSession() {
    try {
      const s = await api.admin.session();
      if (s.up.toLowerCase() === state.up.toLowerCase()) return dashboard();
    } catch { /* no session */ }
    loginPanel();
  }

  function loginPanel(err) {
    const btn = h("button", { type: "button", class: "btn", id: "adminLogin" }, t("adminLogin"));
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const c = await api.admin.challenge(state.up);
        const signature = await signStatement(state.wallet, state.up, c.text);
        await api.admin.login(c.id, signature);
        dashboard();
      } catch (e) {
        loginPanel(e);
      }
    });
    body.replaceChildren(h("section", { class: "panel" }, h("p", {}, t("adminLoginText")), err ? errorNotice(err) : null, h("div", { class: "actions" }, btn)));
  }

  /** Prepare → confirm → send from the owner UP → log. Returns the tx hash or null. */
  async function run(action, args, detail, out) {
    out.replaceChildren();
    try {
      const tx = await api.admin.tx(action, args);
      if (!window.confirm(`${t("adminConfirm")}\n\n${tx.summary}`)) return null;
      if (tx.mainnet && window.prompt(t("adminTypeMainnet")) !== "MAINNET") return null;
      const hash = await sendFromUp(state.wallet, state.up, tx.to, tx.data);
      try { await api.admin.log(action, hash, detail); } catch { /* the indexer still sees the event */ }
      out.replaceChildren(notice("ok", t("adminTxSent"), " ", h("a", { href: explorerTx(hash), target: "_blank", rel: "noopener" }, t("viewTx"))));
      return hash;
    } catch (e) {
      if (codeOf(e) === "ADMIN_LOGIN_REQUIRED") {
        loginPanel(e);
        return null;
      }
      out.replaceChildren(errorNotice(e));
      return null;
    }
  }

  function dashboard() {
    const statusBox = h("div");
    const exceptionsBox = h("div");
    const badgeBox = h("div");
    const logout = h("button", { type: "button", class: "btn secondary" }, t("adminLogout"));
    logout.addEventListener("click", async () => {
      try { await api.admin.logout(); } catch { /* ignore */ }
      loginPanel();
    });
    body.replaceChildren(
      h("section", { class: "panel" }, h("h2", {}, t("adminStatus")), statusBox),
      h("section", { class: "panel" }, h("h2", {}, t("adminExceptions")), exceptionsBox),
      h("section", { class: "panel" }, h("h2", {}, t("adminBadge")), badgeSearch(badgeBox), badgeBox),
      h("div", { class: "actions" }, logout),
    );
    loadStatus(statusBox);
    loadExceptions(exceptionsBox);
  }

  async function loadStatus(box) {
    box.replaceChildren(h("p", {}, h("span", { class: "spinner" }), " ", t("loading")));
    let s;
    try {
      s = await api.admin.status();
    } catch (e) {
      if (codeOf(e) === "ADMIN_LOGIN_REQUIRED") return loginPanel(e);
      return box.replaceChildren(errorNotice(e));
    }
    const fact = (k, v) => [h("dt", {}, t(k)), h("dd", { "data-fact": k }, v ?? "—")];
    const rev = s.revocation;
    const out = h("div");
    const refresh = h("button", { type: "button", class: "btn secondary" }, t("adminRefresh"));
    refresh.addEventListener("click", () => loadStatus(box));
    const metaBtn = h("button", { type: "button", class: "btn secondary", id: "adminSetMetadata" }, t("adminSetMetadata"));
    metaBtn.addEventListener("click", async () => { if (await run("setMetadata", {}, "LSP4Metadata", out)) loadStatus(box).then(() => box.prepend(out)); });
    const stop = s.mintingStopped
      ? h("button", { type: "button", class: "btn", id: "adminRestore" }, t("adminRestore"))
      : h("button", { type: "button", class: "btn danger", id: "adminStop" }, t("adminStop"));
    stop.addEventListener("click", async () => {
      const action = s.mintingStopped ? "restoreAttester" : "stopMinting";
      if (await run(action, {}, null, out)) loadStatus(box).then(() => box.prepend(out));
    });
    fill(box,
      s.mintingStopped ? notice("err", h("strong", { id: "adminStopped" }, t("adminStopped"))) : null,
      h("dl", { class: "facts" },
        fact("adminNetwork", `${s.network} (${s.chainId})`),
        fact("adminContract", h("code", {}, s.contract)),
        fact("adminOwner", h("code", {}, s.owner)),
        fact("adminAttester", h("code", {}, s.attester)),
        fact("adminSigner", s.signer ? h("span", { id: "adminSignerState", class: `status ${s.signer.ready ? "ok" : "warn"}` }, s.signer.ready ? t("adminSignerOk") : s.signer.error) : null),
        fact("adminBalance", s.attesterBalance === null ? null : `${Number(s.attesterBalance).toFixed(4)} LYX`),
        fact("adminActive", `${s.activeBadges.primary} / ${s.activeBadges.additional}`),
        fact("adminQueue", `${s.queue ?? "—"} · ${s.openMints} · ${s.pendingInvalidations}`),
        fact("adminIndexer", s.indexer ? `#${s.indexer.lastBlock} · ${new Date(s.indexer.at).toLocaleString()}` : null),
        fact("adminRevocation", rev ? `${new Date(rev.at).toLocaleString()} · ${rev.checked} / ${rev.revoked} / ${rev.unavailable} / ${rev.errors}` : null),
        fact("adminBackup", s.lastBackup ? new Date(s.lastBackup).toLocaleString() : null),
        fact("adminMetadata", h("span", { id: "adminMetadataState", class: `status ${s.metadata.upToDate ? "ok" : "warn"}` }, s.metadata.upToDate ? t("adminMetadataOk") : t("adminMetadataOld"))),
      ),
      out,
      h("div", { class: "actions" }, refresh, s.metadata.upToDate ? null : metaBtn),
      h("h2", { class: "mt" }, t("adminEmergency")),
      h("p", { class: "small dim" }, s.mintingStopped ? t("adminRestoreText").replace("{address}", s.configuredAttester ?? "—") : t("adminStopText")),
      h("div", { class: "actions" }, stop),
      supersededList(s.superseded ?? [], box, out),
    );
  }

  // UCL-38: earlier contracts of this network must not keep a live attester
  function supersededList(list, box, out) {
    if (!list.length) return null;
    return h("div", {},
      h("h2", { class: "mt" }, t("adminSuperseded")),
      h("p", { class: "small dim" }, t("adminSupersededText")),
      h("ul", { class: "plain" }, ...list.map((c) => {
        const stop = h("button", { type: "button", class: "btn danger", "data-superseded": c.address }, t("adminStop"));
        stop.addEventListener("click", async () => {
          if (await run("stopSuperseded", { address: c.address }, c.address, out)) loadStatus(box).then(() => box.prepend(out));
        });
        return h("li", {}, h("code", {}, c.address), " · ",
          c.stopped ? h("span", { class: "status ok" }, t("adminSupersededStopped"))
            : c.attester === null ? h("span", { class: "status warn" }, t("adminSupersededUnknown"))
              : stop);
      })),
    );
  }

  async function loadExceptions(box) {
    let list;
    try {
      list = await api.admin.exceptions();
    } catch (e) {
      return box.replaceChildren(errorNotice(e));
    }
    if (!list.length) return box.replaceChildren(h("p", { class: "dim" }, t("adminNoExceptions")));
    box.replaceChildren(...list.map((x) => exceptionRow(x, box)));
  }

  function exceptionRow(x, box) {
    const out = h("div");
    const n = h("input", { type: "text", inputmode: "numeric", value: String(x.maxUps || 2), "aria-label": t("adminMaxUps"), class: "narrow" });
    const approve = h("button", { type: "button", class: "btn" }, x.maxUps ? t("adminChange") : t("adminApprove"));
    approve.addEventListener("click", async () => {
      if (await run("approveException", { ticket: x.ticket, maxUps: Number(n.value) }, `${x.ticket} -> ${n.value}`, out)) setTimeout(() => loadExceptions(box), 1500);
    });
    const withdraw = h("button", { type: "button", class: "btn secondary" }, t("adminWithdraw"));
    withdraw.addEventListener("click", async () => {
      if (await run("approveException", { ticket: x.ticket, maxUps: 0 }, `${x.ticket} -> 0`, out)) setTimeout(() => loadExceptions(box), 1500);
    });
    const reject = h("button", { type: "button", class: "btn secondary" }, t("adminReject"));
    reject.addEventListener("click", async () => {
      if (!window.confirm(t("adminRejectConfirm"))) return;
      try {
        await api.admin.reject(x.ticket);
        loadExceptions(box);
      } catch (e) {
        out.replaceChildren(errorNotice(e));
      }
    });
    return h("div", { class: "notice", "data-ticket": x.ticket },
      h("dl", { class: "facts" },
        h("dt", {}, t("adminTicket")), h("dd", {}, h("code", {}, x.ticket)),
        h("dt", {}, "UP"), h("dd", {}, x.up ? h("code", {}, x.up) : "—"),
        h("dt", {}, t("adminRequested")), h("dd", {}, formatDate(x.createdAt)),
        h("dt", {}, t("adminOnChainLimit")), h("dd", {}, x.maxUps ? String(x.maxUps) : t("adminNotApproved")),
      ),
      h("div", { class: "actions" }, h("label", {}, `${t("adminMaxUps")} `, n), approve, x.maxUps ? withdraw : null, x.status === "pending" && !x.maxUps ? reject : null),
      out,
    );
  }

  function badgeSearch(box) {
    const input = h("input", { type: "text", placeholder: t("verifyPlaceholder"), spellcheck: "false", autocomplete: "off", id: "adminUp", "aria-label": t("verifyPlaceholder") });
    const form = h("form", {}, input, h("div", { class: "actions" }, h("button", { type: "submit", class: "btn secondary" }, t("adminSearch"))));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      showBadge(input.value.trim(), box);
    });
    return form;
  }

  async function showBadge(up, box) {
    const out = h("div");
    let b;
    try {
      b = await api.admin.badge(up);
    } catch (e) {
      return box.replaceChildren(errorNotice(e));
    }
    const reason = h("select", { "aria-label": t("adminReason") }, h("option", { value: "REVOKED" }, "REVOKED"), h("option", { value: "ABUSE" }, "ABUSE"));
    const revoke = h("button", { type: "button", class: "btn danger", id: "adminRevoke" }, t("adminRevoke"));
    revoke.addEventListener("click", async () => {
      if (await run("revoke", { up: b.up, reason: reason.value }, `${b.up} ${reason.value}`, out)) setTimeout(() => showBadge(b.up, box).then(() => box.append(out)), 500);
    });
    const reinstate = h("button", { type: "button", class: "btn", id: "adminReinstate" }, t("adminReinstate"));
    reinstate.addEventListener("click", async () => {
      if (await run("reinstate", { up: b.up }, b.up, out)) setTimeout(() => showBadge(b.up, box).then(() => box.append(out)), 500);
    });
    const st = b.onChain.status;
    fill(box,
      h("dl", { class: "facts" },
        h("dt", {}, "UP"), h("dd", {}, h("code", {}, b.up)),
        h("dt", {}, t("adminOnChain")), h("dd", { id: "adminBadgeState" }, st),
        h("dt", {}, t("factPrimary")), h("dd", {}, st === "none" ? "—" : b.onChain.primary ? t("yes") : t("no")),
        h("dt", {}, t("factExpiresAt")), h("dd", {}, formatDate(b.onChain.expiresAt)),
        h("dt", {}, t("adminLocal")), h("dd", {}, b.local ? `${b.local.status}${b.local.lastRevocationCheck ? ` · OCSP ${b.local.lastRevocationCheck}` : ""}` : "—"),
      ),
      h("div", { class: "actions" },
        st !== "none" && st !== "revoked" ? [reason, revoke] : null,
        st === "revoked" ? reinstate : null,
      ),
      out,
    );
  }
}
