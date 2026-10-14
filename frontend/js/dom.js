// Tiny DOM helper. Data from the network or the wallet is always set as text, never as HTML.
// Only static strings written in i18n.js may contain markup (passed with { html }).
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v; // static i18n markup only
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export function storage(kind) {
  const s = (() => { try { return kind === "session" ? sessionStorage : localStorage; } catch { return null; } })();
  return {
    get(k) { try { return s?.getItem(k) ?? null; } catch { return null; } },
    set(k, v) { try { s?.setItem(k, v); } catch { /* not saved */ } },
    del(k) { try { s?.removeItem(k); } catch { /* ignore */ } },
  };
}
