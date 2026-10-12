// ==UserScript==
// @name         Suno Bridge (self-host api)
// @namespace    suno-selfhost
// @version      0.7.7
// @updateURL     https://raw.githubusercontent.com/seitanmen/suno-api-mcp/main/packages/userscript/suno-bridge.user.js
// @downloadURL   https://raw.githubusercontent.com/seitanmen/suno-api-mcp/main/packages/userscript/suno-bridge.user.js
// @description  Sunoのセッション（JWT/Cookie）をローカルAPIに中継する
// @match        https://suno.com/*
// @allframes    1
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      localhost
// @connect      raw.githubusercontent.com
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";
  const API = "http://localhost:4123/v1/auth/ingest";
  const BRIDGE_VERSION = (() => { try { return GM_info.script.version; } catch (_) { return "0.0.0"; } })();
  const DOWNLOAD_URL = "https://raw.githubusercontent.com/seitanmen/suno-api-mcp/main/packages/userscript/suno-bridge.user.js";

  function cmpVer(a, b) {
    const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d;
    }
    return 0;
  }

  function showUpdateBanner(latest) {
    try {
      if (document.getElementById("suno-bridge-update")) return;
      const div = document.createElement("div");
      div.id = "suno-bridge-update";
      div.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#7c2d12;color:#fff;padding:8px 12px;font-size:13px;text-align:center;font-family:sans-serif;";
      div.textContent = "Suno Bridge " + BRIDGE_VERSION + " → " + latest + " があります。更新してください ";
      const btn = document.createElement("button");
      btn.textContent = "今すぐ更新";
      btn.style.cssText = "margin-left:8px;padding:2px 12px;cursor:pointer;";
      btn.onclick = () => { try { GM_openInTab(DOWNLOAD_URL, { active: true }); } catch (_) { window.open(DOWNLOAD_URL, "_blank"); } };
      const later = document.createElement("button");
      later.textContent = "後で";
      later.style.cssText = "margin-left:8px;padding:2px 12px;cursor:pointer;";
      later.onclick = () => div.remove();
      div.appendChild(btn);
      div.appendChild(later);
      (document.body || document.documentElement).appendChild(div);
    } catch (_) {}
  }

  function checkUpdate() {
    try {
      GM_xmlhttpRequest({
        method: "GET",
        url: DOWNLOAD_URL + "?t=" + Date.now(),
        onload: (res) => {
          try {
            const m = String(res.responseText || "").match(/@version\s+(\S+)/);
            if (!m) return;
            GM_setValue("upd_check", Date.now());
            if (cmpVer(m[1], BRIDGE_VERSION) > 0) {
              showUpdateBanner(m[1]);
              if (GM_getValue("upd_prompted", "") !== m[1]) {
                GM_setValue("upd_prompted", m[1]);
                try { GM_openInTab(DOWNLOAD_URL, { active: true }); } catch (_) {}
              }
            }
          } catch (_) {}
        },
      });
    } catch (_) {}
  }
  const isTop = (() => { try { return window.self === window.top; } catch (_) { return false; } })();

  function pageHook() {
    // command execution in PAGE context (called from content script via event)
    window.addEventListener("suno-bridge-cmd", (e) => {
      let c;
      try { c = typeof e.detail === "string" ? JSON.parse(e.detail) : e.detail; } catch (_) { return; }
      const reply = (ok, val) => {
        window.dispatchEvent(new CustomEvent("suno-bridge-cmdres", {
          detail: JSON.stringify({ id: c.id, ok: ok, v: val === undefined ? null : val }),
        }));
      };
      try {
        const fn = new Function("return (async () => { " + c.js + " })();");
        Promise.resolve(fn()).then(
          (r) => { let out; try { out = JSON.stringify(r); } catch (_) { out = String(r); } reply(true, out); },
          (err) => reply(false, String(err && err.stack || err).slice(0, 800))
        );
      } catch (err) { reply(false, String(err).slice(0, 500)); }
    });
    const emitJwt = (auth) => {
      const m = typeof auth === "string" && auth.match(/^Bearer (.+)$/);
      if (m) window.dispatchEvent(new CustomEvent("suno-bridge-jwt", { detail: m[1] }));
    };
    const emitApi = (detail) => {
      window.dispatchEvent(new CustomEvent("suno-bridge-api", { detail: detail }));
    };
    const interesting = (u) => /update_clips|generate\/v2|v2-web|agentic|concat|playlist|generate\/lyrics|stems|personalization|speech|sound/i.test(u || "");
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
    window.addEventListener("suno-bridge-probe-run", (e) => {
      let p;
      try {
        p = typeof e.detail === "string" ? JSON.parse(e.detail) : e.detail;
      } catch (_) { return; }
      const done = (status, text) => {
        window.dispatchEvent(new CustomEvent("suno-bridge-probe-done", {
          detail: JSON.stringify({ id: p.id, status: status, text: String(text).slice(0, 400000) }),
        }));
      };
      if (typeof p.js === "string" && p.js.length > 0) {
        // JS eval probe: runs in page context (access to window.turnstile, etc.)
        try {
          const fn = new Function("return (async () => { " + p.js + " })();");
          Promise.resolve(fn()).then(
            (r) => {
              let out;
              try { out = JSON.stringify(r); } catch (_) { out = String(r); }
              done(200, out === undefined ? "undefined" : out);
            },
            (err) => done(500, "JSERR: " + String(err && err.stack || err).slice(0, 1000))
          );
        } catch (err) {
          done(500, "JSERR: " + String(err).slice(0, 500));
        }
        return;
      }
      const headers = { "Content-Type": "application/json" };
      if (p.token) headers.Authorization = "Bearer " + p.token;
      fetch(p.base + p.path, {
        method: p.method,
        credentials: "include",
        headers: headers,
        body: p.body ? JSON.stringify(p.body) : undefined,
      }).then(async (res) => {
        let text = "";
        try { text = await res.text(); } catch (_) {}
        window.dispatchEvent(new CustomEvent("suno-bridge-probe-done", {
          detail: JSON.stringify({ id: p.id, status: res.status, text: text.slice(0, 400000) }),
        }));
      }).catch((err) => {
        window.dispatchEvent(new CustomEvent("suno-bridge-probe-done", {
          detail: JSON.stringify({ id: p.id, status: 0, text: String(err).slice(0, 500) }),
        }));
      });
    });
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
  // command channel over apilog (works with any server build): poll CMDCALL, eval in page, post CMDRES
  const cmdSeen = GM_getValue("cmd_seen", []);
  window.addEventListener("suno-bridge-cmdres", (e) => {
    try {
      GM_xmlhttpRequest({
        method: "POST",
        url: "http://localhost:4123/v1/apilog",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ line: "CMDRES " + String(e.detail) }),
      });
    } catch (_) {}
  });
  setInterval(() => {
    GM_xmlhttpRequest({
      method: "GET",
      url: "http://localhost:4123/v1/apilog",
      onload: (res) => {
        try {
          const d = JSON.parse(res.responseText);
          const lines = d.lines || [];
          for (const line of lines) {
            if (typeof line !== "string" || !line.startsWith("CMDCALL ")) continue;
            const id = line.slice(8, 20);
            if (cmdSeen.includes(id)) continue;
            cmdSeen.push(id);
            while (cmdSeen.length > 50) cmdSeen.shift();
            GM_setValue("cmd_seen", cmdSeen);
            const bar = line.indexOf(" ||| ");
            const js = bar > 0 ? line.slice(bar + 5) : "null";
            window.dispatchEvent(new CustomEvent("suno-bridge-cmd", { detail: JSON.stringify({ id: id, js: js }) }));
          }
        } catch (_) {}
      },
    });
  }, 3000);
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

  setInterval(() => {
    GM_xmlhttpRequest({
      method: "GET",
      url: "http://localhost:4123/v1/probe/pending",
      onload: (res) => {
        if (res.status !== 200 || !res.responseText) return;
        try {
          const p = JSON.parse(res.responseText);
          p.token = state.jwt;
          window.dispatchEvent(new CustomEvent("suno-bridge-probe-run", { detail: JSON.stringify(p) }));
          logApi("PROBE", "run " + p.id + " " + p.method + " " + p.path, null);
        } catch (_) {}
      },
    });
  }, 3000);
  window.addEventListener("suno-bridge-probe-done", (e) => {
    try {
      const d = typeof e.detail === "string" ? JSON.parse(e.detail) : e.detail;
      GM_xmlhttpRequest({
        method: "POST",
        url: "http://localhost:4123/v1/probe/result",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(d),
      });
      logApi("PROBE", d.id + " -> " + d.status, String(d.text).slice(0, 300));
    } catch (_) {}
  });

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
      data: JSON.stringify({ jwt: state.jwt, cookies: parseCookies(), bridge_version: BRIDGE_VERSION }),
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

  setInterval(push, 60000);
  push();
  // self-update check: every 6h + once shortly after load (top frame only)
  try {
    if (Date.now() - GM_getValue("upd_check", 0) > 6 * 3600 * 1000) checkUpdate();
    setInterval(() => {
      try { if (Date.now() - GM_getValue("upd_check", 0) > 6 * 3600 * 1000) checkUpdate(); } catch (_) {}
    }, 3600000);
  } catch (_) {}

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
        if (/\|\|\|/.test(line)) {
          try {
            GM_xmlhttpRequest({
              method: "POST",
              url: "http://localhost:4123/v1/apilog",
              headers: { "Content-Type": "application/json" },
              data: JSON.stringify({ line: line }),
            });
          } catch (_) {}
        }
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
    const ok = !!state.jwt;
    let fab = document.getElementById("suno-bridge-fab");
    if (!fab) {
      fab = document.createElement("div");
      fab.id = "suno-bridge-fab";
      fab.textContent = "\u266A";
      fab.onclick = () => {
        const c = document.getElementById("suno-bridge-card");
        if (c) c.style.display = c.style.display === "none" ? "block" : "none";
      };
      document.documentElement.appendChild(fab);
    }
    fab.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:999999;width:44px;height:44px;border-radius:50%;" +
      "background:" + (ok ? "#16a34a" : "#7c3aed") + ";color:#fff;font:20px/44px sans-serif;text-align:center;" +
      "cursor:pointer;opacity:.9;box-shadow:0 2px 8px rgba(0,0,0,.4);user-select:none";
    let el = document.getElementById("suno-bridge-card");
    if (!el) {
      el = document.createElement("div");
      el.id = "suno-bridge-card";
      el.style.cssText =
        "position:fixed;right:16px;bottom:68px;z-index:999999;background:#111;color:#eee;" +
        "font:12px sans-serif;padding:10px 12px;border-radius:8px;opacity:.95;max-width:240px;display:none";
      document.documentElement.appendChild(el);
    }
    el.innerHTML =
      "<b>Suno Bridge</b> " + (ok ? "接続中" : "未接続") +
      "<br>送信: " + (state.sent ? new Date(state.sent).toLocaleTimeString() : "—") +
      (state.error ? "<br><span style='color:#f88'>" + state.error + "</span>" : "") +
      "<br><button id='suno-bridge-push'>今すぐ送信</button>";
    document.getElementById("suno-bridge-push").onclick = () => {
      lastSent = 0;
      push();
    };
  }

  function describeEl(el) {
    const o = { tag: el.tagName.toLowerCase() };
    if (el.id) o.id = el.id;
    if (el.name) o.name = el.name;
    if (el.getAttribute("placeholder")) o.ph = el.getAttribute("placeholder").slice(0, 60);
    if (el.getAttribute("aria-label")) o.aria = el.getAttribute("aria-label").slice(0, 60);
    if (el.getAttribute("data-testid")) o.testid = el.getAttribute("data-testid");
    if (el.type) o.type = el.type;
    const txt = (el.innerText || "").trim().slice(0, 40);
    if (txt) o.text = txt;
    o.cls = (el.className && el.className.baseVal !== undefined ? "" : String(el.className || "")).split(" ").slice(0, 3).join(" ");
    return o;
  }

  function formDump() {
    const out = { url: location.href, mode: [], fields: [], buttons: [] };
    const all = document.querySelectorAll("textarea, input, select, [role=switch], [role=tab]");
    all.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const d = describeEl(el);
      d.textarea = el.tagName === "TEXTAREA";
      d.value = String(el.value || "").slice(0, 60);
      (el.tagName === "TEXTAREA" || el.type === "text" || !el.type ? out.fields : out.mode).push(d);
    });
    document.querySelectorAll("button").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const label = el.getAttribute("aria-label") || (el.innerText || "").trim().slice(0, 30);
      if (/作成|シンプル|アドバンスド|カスタム|v4|v5|v6|インスト|create/i.test(label)) out.buttons.push(label);
    });
    return out;
  }

  new MutationObserver(() => {
    if (!document.getElementById("suno-bridge-fab")) render();
  }).observe(document.documentElement, { childList: true, subtree: true });
  render();
})();
