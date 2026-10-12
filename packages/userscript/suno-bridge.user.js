// ==UserScript==
// @name         Suno Bridge (self-host api)
// @namespace    suno-selfhost
// @version      0.5.1
// @updateURL     https://raw.githubusercontent.com/seitanmen/suno-api-mcp/main/packages/userscript/suno-bridge.user.js
// @downloadURL   https://raw.githubusercontent.com/seitanmen/suno-api-mcp/main/packages/userscript/suno-bridge.user.js
// @description  Sunoのセッション（JWT/Cookie）をローカルAPIに中継する
// @match        https://suno.com/*
// @allframes    1
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      localhost
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";
  const API = "http://localhost:4123/v1/auth/ingest";
  const isTop = (() => { try { return window.self === window.top; } catch (_) { return false; } })();

  function pageHook() {
    const emitJwt = (auth) => {
      const m = typeof auth === "string" && auth.match(/^Bearer (.+)$/);
      if (m) window.dispatchEvent(new CustomEvent("suno-bridge-jwt", { detail: m[1] }));
    };
    const emitApi = (detail) => {
      window.dispatchEvent(new CustomEvent("suno-bridge-api", { detail: detail }));
    };
    const interesting = (u) => /update_clips|generate\/v2|concat|playlist|generate\/lyrics|stems/.test(u || "");
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      let u, m;
      try {
        u = typeof input === "string" ? input : input.url;
        m = (init && init.method) || "GET";
        let detail = m + " " + u;
        if (interesting(u) && init && init.body) detail += " ||| " + String(init.body).slice(0, 1500);
        emitApi(detail);
        const h = (init && init.headers) || {};
        if (h instanceof Headers) emitJwt(h.get("Authorization"));
        else emitJwt(h.Authorization || h.authorization);
      } catch (_) {}
      return origFetch.apply(this, arguments).then((res) => {
        try {
          if (interesting(u)) emitApi(m + " " + u + " -> " + res.status);
        } catch (_) {}
        return res;
      });
    };
    const origOpen = XMLHttpRequest.prototype.open;
    const origSet = XMLHttpRequest.prototype.setRequestHeader;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        this._sunoMethod = method;
        this._sunoUrl = String(url);
      } catch (_) {}
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      try {
        let detail = this._sunoMethod + " " + this._sunoUrl;
        if (interesting(this._sunoUrl) && body) detail += " ||| " + String(body).slice(0, 1500);
        emitApi(detail);
      } catch (_) {}
      return origSend.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      try {
        if (/^authorization$/i.test(k)) emitJwt(v);
      } catch (_) {}
      return origSet.apply(this, arguments);
    };
    try {
      const origBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (url, data) {
        try {
          emitApi("BEACON " + url + " ||| " + String(data).slice(0, 1500));
        } catch (_) {}
        return origBeacon(url, data);
      };
    } catch (_) {}
  }

  function injectHook() {
    try {
      const tag = document.createElement("script");
      tag.textContent = "(" + pageHook.toString() + ")();";
      (document.head || document.documentElement).appendChild(tag);
      tag.remove();
    } catch (_) {}
  }

  function relayPush(kind, detail) {
    try {
      const list = GM_getValue("relay", []);
      list.push({ k: kind, d: String(detail).slice(0, 2000), t: Date.now() });
      while (list.length > 100) list.shift();
      GM_setValue("relay", list);
    } catch (_) {}
  }

  if (!isTop) {
    injectHook();
    window.addEventListener("suno-bridge-jwt", (e) => {
      if (typeof e.detail === "string") {
        GM_setValue("jwt", e.detail);
        relayPush("jwt", e.detail.slice(0, 20) + "...");
      }
    });
    window.addEventListener("suno-bridge-api", (e) => {
      if (typeof e.detail === "string") relayPush("api", e.detail);
    });
    return;
  }

  let lastSent = 0;
  const state = { jwt: GM_getValue("jwt", null), at: 0, sent: 0, error: "" };
  injectHook();

  function handleJwt(token) {
    if (typeof token === "string" && token !== state.jwt) {
      state.jwt = token;
      state.at = Date.now();
      GM_setValue("jwt", token);
      render();
      push();
    }
  }

  window.addEventListener("suno-bridge-jwt", (e) => handleJwt(e.detail));
  window.addEventListener("suno-bridge-api", (e) => {
    if (typeof e.detail !== "string") return;
    const sp = e.detail.indexOf(" ");
    const bar = e.detail.indexOf(" ||| ");
    const arrow = e.detail.indexOf(" -> ");
    const method = e.detail.slice(0, sp);
    let url, body;
    if (bar > 0) {
      url = e.detail.slice(sp + 1, bar);
      body = e.detail.slice(bar + 5);
    } else if (arrow > 0) {
      url = e.detail.slice(sp + 1, arrow);
      body = "HTTP " + e.detail.slice(arrow + 4);
    } else {
      url = e.detail.slice(sp + 1);
      body = null;
    }
    logApi(method, url, body);
  });

  setInterval(() => {
    try {
      const list = GM_getValue("relay", []);
      if (!list.length) return;
      GM_setValue("relay", []);
      for (const item of list) {
        if (item.k === "api" && typeof item.d === "string") {
          const sp = item.d.indexOf(" ");
          const bar = item.d.indexOf(" ||| ");
          const arrow = item.d.indexOf(" -> ");
          const method = item.d.slice(0, sp);
          let url, body;
          if (bar > 0) {
            url = item.d.slice(sp + 1, bar);
            body = item.d.slice(bar + 5);
          } else if (arrow > 0) {
            url = item.d.slice(sp + 1, arrow);
            body = "HTTP " + item.d.slice(arrow + 4);
          } else {
            url = item.d.slice(sp + 1);
            body = null;
          }
          logApi("[f] " + method, url, body);
        }
      }
      const j = GM_getValue("jwt", null);
      if (j) handleJwt(j);
    } catch (_) {}
  }, 2000);

  function parseCookies() {
    const out = {};
    try {
      for (const part of document.cookie.split(";")) {
        const eq = part.indexOf("=");
        if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
      }
    } catch (_) {}
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
  const FULLLOG = GM_getValue("fulllog", false);
  function logApi(method, url, body) {
    try {
      const u = new URL(url, location.href);
      if (!/suno\.com/.test(u.hostname)) return;
      const isMutation = /^(POST|PUT|PATCH|DELETE|BEACON|\[f\] (POST|PUT|PATCH|DELETE|BEACON))$/.test(method);
      if (!FULLLOG && !u.pathname.startsWith("/api/") && !u.pathname.startsWith("/v1/") && !isMutation) return;
      let line = method + " " + u.hostname + u.pathname + u.search;
      if (body) line += " ||| " + body;
      if (apiLog[apiLog.length - 1] !== line) {
        apiLog.push(line);
        while (apiLog.length > 50) apiLog.shift();
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
      "<b>Suno Bridge v0.5.1</b><br>JWT: " + jwtShort +
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
