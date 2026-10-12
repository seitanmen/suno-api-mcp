// ==UserScript==
// @name         Suno Bridge (self-host api)
// @namespace    suno-selfhost
// @version      0.4.0
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
  const EVT = "suno-bridge-jwt";
  let lastSent = 0;
  const state = { jwt: GM_getValue("jwt", null), at: 0, sent: 0, error: "" };

  function pageHook() {
    const emit = (auth) => {
      const m = typeof auth === "string" && auth.match(/^Bearer (.+)$/);
      if (m) window.dispatchEvent(new CustomEvent("suno-bridge-jwt", { detail: m[1] }));
    };
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      try {
        const u = typeof input === "string" ? input : input.url;
        const m = (init && init.method) || "GET";
        let detail = m + " " + u;
        if (/update_clips|generate\/v2|concat|playlist\/create/.test(u) && init && init.body) {
          detail += " ||| " + String(init.body).slice(0, 1500);
        }
        window.dispatchEvent(new CustomEvent("suno-bridge-api", { detail: detail }));
        const h = (init && init.headers) || {};
        if (h instanceof Headers) emit(h.get("Authorization"));
        else emit(h.Authorization || h.authorization);
      } catch (_) {}
      return origFetch.apply(this, arguments);
    };
    const origOpen = XMLHttpRequest.prototype.open;
    const origSet = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function () {
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      try {
        if (/^authorization$/i.test(k)) emit(v);
      } catch (_) {}
      return origSet.apply(this, arguments);
    };
  }

  const tag = document.createElement("script");
  tag.textContent = "(" + pageHook.toString().replace(/suno-bridge-jwt/g, EVT) + ")();";
  (document.head || document.documentElement).appendChild(tag);
  tag.remove();

  window.addEventListener("suno-bridge-api", (e) => {
    if (typeof e.detail !== "string") return;
    const sp = e.detail.indexOf(" ");
    const bar = e.detail.indexOf(" ||| ");
    const method = e.detail.slice(0, sp);
    const url = bar > 0 ? e.detail.slice(sp + 1, bar) : e.detail.slice(sp + 1);
    const body = bar > 0 ? e.detail.slice(bar + 5) : null;
    logApi(method, url, body);
  });
  window.addEventListener(EVT, (e) => {
    if (typeof e.detail === "string" && e.detail !== state.jwt) {
      state.jwt = e.detail;
      state.at = Date.now();
      GM_setValue("jwt", e.detail);
      render();
      push();
    }
  });

  function parseCookies() {
    const out = {};
    for (const part of document.cookie.split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
    return out;
  }

  function push() {
    const now = Date.now();
    if (now - lastSent < 15000 || !state.jwt) return;
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
        state.error = "API未起動？ このマシンで bun run api を起動してください";
        render();
      },
    });
  }

  const apiLog = [];
  function logApi(method, url, body) {
    try {
      const u = new URL(url, location.href);
      if (!/suno\.com$|suno\.com/.test(u.hostname)) return;
      if (!u.pathname.startsWith("/api/")) return;
      let line = method + " " + u.pathname;
      if (body) line += " ||| " + body;
      if (apiLog[apiLog.length - 1] !== line) {
        apiLog.push(line);
        if (apiLog.length > 15) apiLog.shift();
        const pre = document.getElementById("suno-bridge-apilog");
        if (pre) pre.textContent = apiLog.join("\n");
      }
    } catch (_) {}
  }

  function domDump() {
    const out = { url: location.href, captcha: [], fields: [], buttons: [] };
    document.querySelectorAll("iframe").forEach((f) => {
      if (/captcha/i.test(f.src || f.title || "")) out.captcha.push(f.src || f.title);
    });
    document.querySelectorAll("[data-sitekey]").forEach((el) => out.captcha.push(el.getAttribute("data-sitekey")));
    document.querySelectorAll("textarea, input[type=text], input:not([type])").forEach((el) => {
      out.fields.push(el.getAttribute("placeholder") || el.getAttribute("aria-label") || el.className.toString().slice(0, 80));
    });
    document.querySelectorAll("button").forEach((el) => {
      const label = el.getAttribute("aria-label") || el.innerText.trim().slice(0, 30);
      if (label) out.buttons.push(label);
    });
    out.hasHcaptcha = typeof window.hcaptcha !== "undefined";
    return out;
  }

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
      "<button id='suno-bridge-push'>今すぐ送信</button> " +
      "<button id='suno-bridge-dom'>DOM調査</button>" +
      "<pre id='suno-bridge-apilog' style='max-height:100px;overflow:auto'></pre>" +
      "<textarea id='suno-bridge-domout' style='width:100%;height:60px;display:none'></textarea>";
    document.getElementById("suno-bridge-copy").onclick = () => {
      navigator.clipboard.writeText(JSON.stringify({ jwt: state.jwt, cookies: parseCookies() }));
    };
    document.getElementById("suno-bridge-push").onclick = () => {
      lastSent = 0;
      push();
    };
    document.getElementById("suno-bridge-dom").onclick = () => {
      const t = document.getElementById("suno-bridge-domout");
      t.style.display = "block";
      t.value = JSON.stringify(domDump(), null, 1).slice(0, 3000);
      t.select();
    };
  }

  new MutationObserver(() => {
    if (!document.getElementById("suno-bridge-panel")) render();
  }).observe(document.documentElement, { childList: true, subtree: true });
  render();
})();
