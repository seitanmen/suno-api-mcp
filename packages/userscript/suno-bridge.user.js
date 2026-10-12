// ==UserScript==
// @name         Suno Bridge (self-host api)
// @namespace    suno-selfhost
// @version      0.1.0
// @description  Sunoのセッション（JWT/Cookie）をローカルAPIに中継する
// @match        https://suno.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      localhost
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";
  const API = "http://localhost:4123/v1/auth/ingest";
  let lastSent = 0;
  const state = { jwt: null, at: 0, sent: 0, error: "" };

  function parseCookies() {
    const out = {};
    for (const part of document.cookie.split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
    return out;
  }

  function maybeCapture(auth) {
    const m = typeof auth === "string" && auth.match(/^Bearer (.+)$/);
    if (m && m[1] !== state.jwt) {
      state.jwt = m[1];
      state.at = Date.now();
      GM_setValue("jwt", m[1]);
      push();
    }
  }

  function push() {
    const now = Date.now();
    if (now - lastSent < 30000 || !state.jwt) return;
    lastSent = now;
    GM_xmlhttpRequest({
      method: "POST",
      url: API,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ jwt: state.jwt, cookies: parseCookies() }),
      onload: (res) => {
        state.sent = now;
        state.error = res.status === 200 ? "" : "HTTP " + res.status;
        render();
      },
      onerror: () => {
        state.error = "API未起動？ bun run api を起動してください";
        render();
      },
    });
  }

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const h = (init && init.headers) || {};
      if (h instanceof Headers) maybeCapture(h.get("Authorization"));
      else maybeCapture(h.Authorization || h.authorization);
    } catch (_) {}
    return origFetch.apply(this, arguments);
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function () {
    this._sunoHeaders = {};
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try {
      this._sunoHeaders[k] = v;
      if (/^authorization$/i.test(k)) maybeCapture(v);
    } catch (_) {}
    return origSet.apply(this, arguments);
  };

  function render() {
    let el = document.getElementById("suno-bridge-panel");
    if (!el) {
      el = document.createElement("div");
      el.id = "suno-bridge-panel";
      el.style.cssText =
        "position:fixed;right:12px;bottom:12px;z-index:999999;background:#111;color:#eee;" +
        "font:12px sans-serif;padding:10px 12px;border-radius:8px;opacity:.92;max-width:280px";
      document.documentElement.appendChild(el);
    }
    const jwtShort = state.jwt ? state.jwt.slice(0, 10) + "..." : "未取得";
    el.innerHTML =
      "<b>Suno Bridge</b><br>JWT: " + jwtShort +
      "<br>送信: " + (state.sent ? new Date(state.sent).toLocaleTimeString() : "—") +
      (state.error ? "<br><span style='color:#f88'>" + state.error + "</span>" : "") +
      "<br><button id='suno-bridge-copy'>コピー</button> " +
      "<button id='suno-bridge-push'>今すぐ送信</button>";
    document.getElementById("suno-bridge-copy").onclick = () => {
      navigator.clipboard.writeText(JSON.stringify({ jwt: state.jwt, cookies: parseCookies() }));
    };
    document.getElementById("suno-bridge-push").onclick = () => {
      lastSent = 0;
      push();
    };
  }

  new MutationObserver(() => {
    if (!document.getElementById("suno-bridge-panel")) render();
  }).observe(document.documentElement, { childList: true, subtree: true });
  render();
  state.jwt = GM_getValue("jwt", null);
})();
