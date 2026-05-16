// ==UserScript==
// @name         Auto-Approve Deploy Gates
// @namespace    https://github.com/auto-deploy-gates
// @version      1.0.3
// @author       auto-deploy
// @description  Automatically click "Start all waiting jobs" on Deploy (PRD) workflow runs
// @homepageURL  https://github.com/TD-Yofun/talkdesk-auto-deploy
// @supportURL   https://github.com/TD-Yofun/talkdesk-auto-deploy/issues
// @downloadURL  https://github.com/TD-Yofun/talkdesk-auto-deploy/releases/latest/download/auto-approve-deploy.min.user.js
// @updateURL    https://github.com/TD-Yofun/talkdesk-auto-deploy/releases/latest/download/auto-approve-deploy.min.user.js
// @match        https://github.com/*
// @connect      api.github.com
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_info
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function parseUrl() {
    const urlMatch = location.pathname.match(
      /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/
    );
    if (!urlMatch) return null;
    const [, owner, repo, runId] = urlMatch;
    return { owner, repo, runId };
  }
  const DEPLOY_PRD_RE = /Deploy\s*\(\s*PRD\s*\)/i;
  function isDeployPRDPage() {
    const labels = document.querySelectorAll(
      ".PageHeader-parentLink-label"
    );
    for (const lbl of labels) {
      if (DEPLOY_PRD_RE.test(lbl.textContent || "")) return true;
    }
    return false;
  }
  function getWorkflowName() {
    const lbl = document.querySelector(
      ".PageHeader-parentLink-label"
    );
    return lbl ? (lbl.textContent || "").trim() : "";
  }
  function loadConfig() {
    return {
      interval: GM_getValue("interval", 15),
      saveLog: GM_getValue("save_log", false),
      panelVisible: GM_getValue("panel_visible", true)
    };
  }
  function saveConfigField(key, value) {
    const keyMap = {
      interval: "interval",
      saveLog: "save_log",
      panelVisible: "panel_visible"
    };
    GM_setValue(keyMap[key], value);
  }
  function createState() {
    return {
      running: false,
      pollTimer: null,
      startRunId: null,
      sessionApproved: 0,
      totalApproved: 0,
      lastSkipKey: "",
      monitorStartedAt: 0,
      pollCycle: 0,
      sessionSkipped: 0,
      sessionEvents: []
    };
  }
  let _logBuffer = [];
  let _logFlushTimer = null;
  let _saveLog = false;
  let _logStoreKey = "";
  function initLogStore(runId, saveLog) {
    _logStoreKey = `aad_log_${runId}`;
    _saveLog = saveLog;
  }
  function setLogSaving(enabled) {
    _saveLog = enabled;
  }
  function _flushLogBuffer() {
    if (_logBuffer.length === 0) return;
    const arr = GM_getValue(_logStoreKey, []);
    const existing = typeof arr === "string" ? arr ? arr.split("\n").filter(Boolean) : [] : arr;
    existing.push(..._logBuffer);
    if (existing.length > 2e3) existing.splice(0, existing.length - 2e3);
    GM_setValue(_logStoreKey, existing);
    _logBuffer = [];
  }
  function appendLogToStore(line) {
    if (!_saveLog) return;
    _logBuffer.push(line);
    if (_logBuffer.length >= 20) {
      _flushLogBuffer();
    } else {
      if (_logFlushTimer) clearTimeout(_logFlushTimer);
      _logFlushTimer = setTimeout(_flushLogBuffer, 500);
    }
  }
  function getStoredLogs() {
    _flushLogBuffer();
    const data = GM_getValue(_logStoreKey, []);
    if (typeof data === "string") {
      return data ? data.split("\n").filter(Boolean) : [];
    }
    return data;
  }
  function downloadLog(runId) {
    const lines = getStoredLogs();
    if (lines.length === 0) {
      alert("当前 Run 暂无日志记录");
      return;
    }
    const content = lines.join("\n") + "\n";
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aad-run-${runId}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function saveRunningState(runId, on) {
    const stateKey = `aad_running_${runId}`;
    GM_setValue(stateKey, on ? Date.now() : 0);
  }
  function wasRunning(runId) {
    const stateKey = `aad_running_${runId}`;
    const savedTs = GM_getValue(stateKey, 0);
    return savedTs > 0 && Date.now() - savedTs < 30 * 60 * 1e3;
  }
  function saveSession(runId, state2) {
    const sessionKey = `aad_session_${runId}`;
    GM_setValue(sessionKey, {
      approved: state2.sessionApproved,
      skipped: state2.sessionSkipped,
      events: state2.sessionEvents,
      startedAt: state2.monitorStartedAt,
      pollCycle: state2.pollCycle,
      lastSkipKey: state2.lastSkipKey
    });
  }
  function loadSession(runId, state2) {
    const sessionKey = `aad_session_${runId}`;
    const s = GM_getValue(sessionKey, null);
    if (!s) return false;
    state2.sessionApproved = s.approved || 0;
    state2.sessionSkipped = s.skipped || 0;
    state2.sessionEvents = s.events || [];
    state2.monitorStartedAt = s.startedAt || Date.now();
    state2.pollCycle = s.pollCycle || 0;
    state2.lastSkipKey = s.lastSkipKey || "";
    return true;
  }
  function clearSession(runId) {
    const sessionKey = `aad_session_${runId}`;
    GM_setValue(sessionKey, null);
  }
  function observeSkipButton(onDetected) {
    const check = (el2) => /start all waiting/i.test(el2.textContent || "");
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (check(node)) {
            onDetected();
            return;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const existing = document.querySelectorAll('button, [role="button"], summary');
    for (const btn of existing) {
      if (check(btn)) {
        onDetected();
        break;
      }
    }
    return () => observer.disconnect();
  }
  async function trySkipWaitTimers(owner, repo, addLog2, skipInitialDelay = false) {
    try {
      await new Promise((r) => setTimeout(r, skipInitialDelay ? 300 : 2e3));
      const allForms = [...document.querySelectorAll("form")];
      const skipForms = allForms.filter((f) => {
        const a = f.getAttribute("action") || "";
        return a.includes("environment") || a.includes("skip");
      });
      addLog2(`[skip-debug] Forms total: ${allForms.length}, skip-related: ${skipForms.length}`);
      skipForms.forEach(
        (f) => addLog2(`[skip-debug]   form action="${f.getAttribute("action")}"`)
      );
      const allBtns = [...document.querySelectorAll('button, [role="button"], summary, a.btn')];
      const relevantBtns = allBtns.filter(
        (b) => /start|skip|waiting|timer|deploy|approve|consequence/i.test(b.textContent || "")
      );
      addLog2(`[skip-debug] Relevant buttons: ${relevantBtns.length}`);
      relevantBtns.forEach(
        (b) => addLog2(`[skip-debug]   <${b.tagName.toLowerCase()}> "${(b.textContent || "").trim().slice(0, 80)}"`)
      );
      const gateInputs = document.querySelectorAll('input[name="gate_request[]"]');
      addLog2(`[skip-debug] gate_request[] inputs: ${gateInputs.length}`);
      gateInputs.forEach((i) => addLog2(`[skip-debug]   value="${i.value}"`));
      for (const btn of allBtns) {
        const text = (btn.textContent || "").trim();
        if (/start all waiting/i.test(text)) {
          addLog2(`[skip] Approach 1: clicking "${text}"`);
          btn.click();
          let dialog = null;
          for (let i = 0; i < 10; i++) {
            dialog = document.querySelector("#gates-break-glass-dialog[open], dialog[open].js-gates-dialog");
            if (dialog) break;
            await new Promise((r) => setTimeout(r, 500));
          }
          if (!dialog) {
            addLog2("[skip] Approach 1: dialog did not appear after clicking button", "warn");
            break;
          }
          addLog2(`[skip]   dialog found: #${dialog.id}`);
          const checkboxes = dialog.querySelectorAll(
            'input[type="checkbox"][name="gate_request[]"], input.js-gates-dialog-environment-checkbox'
          );
          addLog2(`[skip]   checkboxes found: ${checkboxes.length}`);
          checkboxes.forEach((cb) => {
            if (!cb.checked) {
              cb.click();
              addLog2(`[skip]   checked: ${cb.value} (${cb.id})`);
            } else {
              addLog2(`[skip]   already checked: ${cb.value}`);
            }
          });
          if (checkboxes.length === 0) {
            addLog2("[skip] Approach 1: no checkboxes found in dialog", "warn");
            break;
          }
          await new Promise((r) => setTimeout(r, 300));
          const submitBtn = dialog.querySelector(
            'button[type="submit"], button.btn-danger, button[data-target="break-glass-deployments"]'
          );
          if (submitBtn) {
            const st = (submitBtn.textContent || "").trim();
            addLog2(`[skip]   clicking submit: "${st.slice(0, 60)}"`, "ok");
            submitBtn.click();
            await new Promise((r) => setTimeout(r, 3e3));
            return true;
          }
          addLog2("[skip] Approach 1: no submit button found in dialog", "warn");
          break;
        }
      }
      for (const form of skipForms) {
        const action = form.getAttribute("action") || "";
        if (action.endsWith("/skip")) {
          addLog2(`[skip] Approach 2: submitting form → ${action}`);
          const formData = new FormData(form);
          let addedGates = 0;
          if (!formData.has("gate_request[]")) {
            gateInputs.forEach((i) => {
              formData.append("gate_request[]", i.value);
              addedGates++;
            });
          }
          addLog2(`[skip]   form fields: ${[...formData.keys()].join(", ")} (added ${addedGates} gate_request from DOM)`);
          if (!formData.has("gate_request[]")) {
            addLog2(`[skip] Approach 2: no gate_request[] — skipping`, "warn");
            continue;
          }
          const resp = await fetch(action, {
            method: "POST",
            body: new URLSearchParams(formData),
            credentials: "same-origin",
            redirect: "follow"
          });
          addLog2(`[skip]   response: ${resp.status} ${resp.type} ${resp.url}`);
          if (resp.ok || resp.redirected) {
            addLog2(`[skip] Approach 2: form submitted OK`, "ok");
            return true;
          }
          addLog2(`[skip] Approach 2: form submit failed (${resp.status})`, "warn");
        }
      }
      const csrfInput = skipForms.length > 0 ? skipForms[0].querySelector('input[name="authenticity_token"]') : null;
      if (csrfInput && gateInputs.length > 0) {
        const csrf = csrfInput.value;
        addLog2(`[skip] Approach 3: manual POST with CSRF from form + ${gateInputs.length} gate(s)`);
        const body = new URLSearchParams();
        body.append("authenticity_token", csrf);
        body.append("comment", "Auto-skipped by Auto-Approve Deploy Gates");
        gateInputs.forEach((i) => body.append("gate_request[]", i.value));
        const skipUrl = `/${owner}/${repo}/environments/skip`;
        addLog2(`[skip]   POST → ${skipUrl}`);
        const resp = await fetch(skipUrl, {
          method: "POST",
          body,
          credentials: "same-origin",
          redirect: "follow"
        });
        addLog2(`[skip]   response: ${resp.status} ${resp.type} ${resp.url}`);
        if (resp.ok || resp.redirected) {
          addLog2(`[skip] Approach 3: POST succeeded`, "ok");
          return true;
        }
        addLog2(`[skip] Approach 3: POST failed (${resp.status})`, "warn");
      }
      addLog2("[skip] All approaches exhausted — no skip controls found", "warn");
      return false;
    } catch (e) {
      addLog2(`[skip] Error: ${e.message}`, "warn");
      return false;
    }
  }
  const REPO = "TD-Yofun/talkdesk-auto-deploy";
  const CACHE_KEY = "aad_version_cache";
  const CACHE_TTL_MS = 60 * 60 * 1e3;
  function getCurrentVersion() {
    var _a;
    try {
      return ((_a = GM_info == null ? void 0 : GM_info.script) == null ? void 0 : _a.version) || "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
  async function checkLatestVersion(current) {
    const cached = readCache();
    if (cached) {
      return {
        current,
        latest: cached.latest,
        outdated: isNewer(cached.latest, current),
        releaseUrl: cached.releaseUrl,
        releaseNotes: cached.releaseNotes
      };
    }
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://api.github.com/repos/${REPO}/releases/latest`,
        headers: { Accept: "application/vnd.github+json" },
        onload(r) {
          if (r.status >= 200 && r.status < 300) {
            try {
              const data = JSON.parse(r.responseText);
              const latest = String(data.tag_name || "").replace(/^v/, "");
              const releaseUrl = data.html_url || `https://github.com/${REPO}/releases/latest`;
              const releaseNotes = String(data.body || "").trim();
              writeCache({ latest, releaseUrl, releaseNotes, ts: Date.now() });
              resolve({
                current,
                latest,
                outdated: isNewer(latest, current),
                releaseUrl,
                releaseNotes
              });
            } catch {
              reject(new Error("Failed to parse latest release"));
            }
          } else if (r.status === 404) {
            resolve({ current, latest: current, outdated: false, releaseUrl: `https://github.com/${REPO}/releases`, releaseNotes: "" });
          } else {
            reject(new Error(`HTTP ${r.status}`));
          }
        },
        onerror() {
          reject(new Error("Network error"));
        }
      });
    });
  }
  function readCache() {
    try {
      const raw = GM_getValue(CACHE_KEY, "");
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - data.ts > CACHE_TTL_MS) return null;
      return data;
    } catch {
      return null;
    }
  }
  function writeCache(data) {
    try {
      GM_setValue(CACHE_KEY, JSON.stringify(data));
    } catch {
    }
  }
  function isNewer(a, b) {
    const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
    const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0;
      const y = pb[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  }
  const ts = () => ( new Date()).toLocaleTimeString("en-US", { hour12: false });
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  function injectStyles() {
    GM_addStyle(`
    /* ── Side Panel ───────────────────────────────────────── */
    #aad-panel {
      position: fixed !important;
      top: 0; right: 0;
      width: 360px;
      height: 100vh;
      background: #161b22;
      border-left: 1px solid #30363d;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 13px;
      z-index: 2147483647 !important;
      box-shadow: -4px 0 16px rgba(0,0,0,.3);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: transform .3s cubic-bezier(.4,0,.2,1);
    }
    #aad-panel.collapsed { transform: translateX(100%); }

    /* ── Collapse Tab ─────────────────────────────────────── */
    #aad-tab {
      position: fixed !important;
      top: 50%; right: 0;
      transform: translateY(-50%);
      z-index: 2147483647 !important;
      background: #0d1117;
      border: 1px solid #30363d;
      border-right: none;
      border-radius: 8px 0 0 8px;
      padding: 10px 5px;
      cursor: pointer;
      color: #8b949e;
      font-size: 11px;
      font-weight: 600;
      writing-mode: vertical-rl;
      letter-spacing: 1px;
      user-select: none;
      transition: right .3s cubic-bezier(.4,0,.2,1), background .15s;
    }
    #aad-tab:hover { background: #161b22; color: #e6edf3; }
    #aad-tab.shifted { right: 360px; }

    /* ── Header ───────────────────────────────────────────── */
    #aad-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #0d1117;
      border-bottom: 1px solid #30363d;
      flex-shrink: 0;
      user-select: none;
    }
    #aad-header .aad-title {
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #aad-header .aad-btns { display: flex; gap: 4px; }
    #aad-header .aad-btns button {
      background: none;
      border: none;
      color: #8b949e;
      cursor: pointer;
      font-size: 16px;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }
    #aad-header .aad-btns button:hover { color: #e6edf3; background: #30363d; }

    /* ── Body ─────────────────────────────────────────────── */
    #aad-body {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      flex: 1;
      min-height: 0;
    }

    /* ── Info ─────────────────────────────────────────────── */
    #aad-info {
      padding: 10px 14px;
      border-bottom: 1px solid #21262d;
      font-size: 12px;
      color: #8b949e;
      line-height: 1.6;
      flex-shrink: 0;
    }
    #aad-info strong { color: #e6edf3; font-weight: 500; }
    #aad-info .aad-run-name { color: #58a6ff; }
    #aad-info .aad-status-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 500;
    }
    .aad-badge-queued      { background: #d29922; color: #0d1117; }
    .aad-badge-in_progress { background: #58a6ff; color: #0d1117; }
    .aad-badge-waiting     { background: #d29922; color: #0d1117; }
    .aad-badge-completed   { background: #3fb950; color: #0d1117; }
    .aad-badge-failure     { background: #f85149; color: #0d1117; }

    /* ── Controls ─────────────────────────────────────────── */
    #aad-controls {
      padding: 10px 14px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid #21262d;
      flex-shrink: 0;
    }
    #aad-toggle-btn {
      padding: 5px 16px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      color: #fff;
      transition: background .15s;
    }
    #aad-toggle-btn.start { background: #238636; }
    #aad-toggle-btn.start:hover { background: #2ea043; }
    #aad-toggle-btn.stop  { background: #da3633; }
    #aad-toggle-btn.stop:hover  { background: #f85149; }
    #aad-controls label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #8b949e;
      cursor: pointer;
    }
    #aad-controls label:hover { color: #e6edf3; }
    #aad-controls input[type="checkbox"] { accent-color: #238636; }
    #aad-interval-wrap {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: #8b949e;
    }
    #aad-interval-input {
      width: 40px;
      padding: 2px 4px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 4px;
      color: #e6edf3;
      font-size: 12px;
      text-align: center;
    }
    #aad-token-btn, #aad-dl-log-btn {
      background: none;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #8b949e;
      cursor: pointer;
      font-size: 11px;
      padding: 3px 8px;
    }
    #aad-token-btn:hover, #aad-dl-log-btn:hover { color: #e6edf3; border-color: #8b949e; }
    #aad-controls .aad-disabled { opacity: 0.4; pointer-events: none; }

    /* ── Status Bar ───────────────────────────────────────── */
    #aad-status-bar {
      padding: 8px 14px;
      font-size: 12px;
      color: #8b949e;
      border-bottom: 1px solid #21262d;
      display: flex;
      justify-content: space-between;
      flex-shrink: 0;
    }
    #aad-status-bar .aad-counters strong { color: #3fb950; }

    /* ── Log Path ─────────────────────────────────────────── */
    #aad-log-path {
      padding: 4px 14px;
      font-size: 11px;
      color: #58a6ff;
      border-bottom: 1px solid #21262d;
      display: none;
      flex-shrink: 0;
    }

    /* ── Summary Report ───────────────────────────────────── */
    #aad-summary {
      padding: 12px 14px;
      border-bottom: 1px solid #21262d;
      display: none;
      flex-shrink: 0;
      max-height: 40vh;
      overflow-y: auto;
    }
    .aad-summary-header {
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 8px;
      color: #e6edf3;
    }
    .aad-summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 16px;
    }
    .aad-summary-item {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
    }
    .aad-summary-label { color: #8b949e; }
    .aad-timeline {
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
      line-height: 1.6;
    }
    .aad-timeline-item { color: #8b949e; }

    /* ── Log ──────────────────────────────────────────────── */
    #aad-log {
      flex: 1;
      overflow-y: auto;
      padding: 8px 14px;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
      font-size: 12px;
      line-height: 1.6;
      min-height: 0;
    }
    #aad-log::-webkit-scrollbar { width: 6px; }
    #aad-log::-webkit-scrollbar-track { background: transparent; }
    #aad-log::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
    .aad-log-entry { white-space: pre-wrap; word-break: break-word; }
    .aad-log-time  { color: #484f58; }
    .aad-log-info  { color: #8b949e; }
    .aad-log-ok    { color: #3fb950; }
    .aad-log-warn  { color: #d29922; }
    .aad-log-err   { color: #f85149; }
  `);
  }
  function buildUI(runId, config2) {
    const panel = document.createElement("div");
    panel.id = "aad-panel";
    panel.innerHTML = `
    <div id="aad-header">
      <span class="aad-title">🚀 Auto-Approve Deploy</span>
      <span class="aad-btns">
        <button id="aad-collapse-btn" title="Collapse panel">▶</button>
      </span>
    </div>
    <div id="aad-body">
      <div id="aad-info">Loading run info...</div>
      <div id="aad-controls">
        <button id="aad-toggle-btn" class="start">▶ Start</button>
        <div id="aad-interval-wrap">
          ⏱ <input id="aad-interval-input" type="number" min="5" max="300" value="${config2.interval}">s
        </div>
        <label><input type="checkbox" id="aad-chk-savelog" ${config2.saveLog ? "checked" : ""}> 💾 Log</label>
        <button id="aad-dl-log-btn" title="Download log file">📥</button>
      </div>
      <div id="aad-status-bar">
        <span id="aad-status-text">Idle</span>
        <span class="aad-counters">Session: <strong id="aad-session-cnt">0</strong> · Total: <strong id="aad-total-cnt">0</strong></span>
      </div>
      <div id="aad-log-path">💾 日志将保存至浏览器下载目录: aad-run-${runId}.log</div>
      <div id="aad-summary"></div>
      <div id="aad-log"></div>
    </div>
  `;
    document.body.appendChild(panel);
    const tab = document.createElement("div");
    tab.id = "aad-tab";
    tab.className = "shifted";
    tab.textContent = "◀ AAD";
    tab.title = "Toggle Auto-Approve Deploy panel";
    document.body.appendChild(tab);
    const el2 = {
      panel,
      tab,
      $info: document.getElementById("aad-info"),
      $toggleBtn: document.getElementById("aad-toggle-btn"),
      $intervalIn: document.getElementById("aad-interval-input"),
      $chkSaveLog: document.getElementById("aad-chk-savelog"),
      $dlLogBtn: document.getElementById("aad-dl-log-btn"),
      $logPath: document.getElementById("aad-log-path"),
      $statusText: document.getElementById("aad-status-text"),
      $sessionCnt: document.getElementById("aad-session-cnt"),
      $totalCnt: document.getElementById("aad-total-cnt"),
      $log: document.getElementById("aad-log"),
      $summary: document.getElementById("aad-summary")
    };
    if (config2.saveLog) el2.$logPath.style.display = "block";
    if (!config2.panelVisible) {
      panel.classList.add("collapsed");
      tab.classList.remove("shifted");
      tab.textContent = "◀ AAD";
    }
    function togglePanel() {
      const isCollapsed = panel.classList.toggle("collapsed");
      tab.classList.toggle("shifted", !isCollapsed);
      tab.textContent = isCollapsed ? "◀ AAD" : "▶";
      config2.panelVisible = !isCollapsed;
      saveConfigField("panelVisible", config2.panelVisible);
    }
    tab.addEventListener("click", togglePanel);
    document.getElementById("aad-collapse-btn").addEventListener("click", togglePanel);
    return el2;
  }
  function renderRunInfo(el2, info) {
    el2.$info.innerHTML = `
    <strong>${esc(info.owner)}/${esc(info.repo)}</strong><br>
    <span class="aad-run-name">${esc(info.workflow || "Workflow")}</span>${info.branch ? " · " + esc(info.branch) : ""}<br>
    Run: <a href="/${esc(info.owner)}/${esc(info.repo)}/actions/runs/${esc(info.runId)}" style="color:#58a6ff">#${esc(info.runId)}</a>
  `;
  }
  function renderToggle(el2, running) {
    if (running) {
      el2.$toggleBtn.textContent = "⏹ Stop";
      el2.$toggleBtn.className = "stop";
      setControlsEnabled(el2, false);
    } else {
      el2.$toggleBtn.textContent = "▶ Start";
      el2.$toggleBtn.className = "start";
      setControlsEnabled(el2, true);
    }
  }
  function renderCounters(el2, state2) {
    el2.$sessionCnt.textContent = String(state2.sessionApproved);
    el2.$totalCnt.textContent = String(state2.totalApproved);
  }
  function setStatus(el2, html) {
    el2.$statusText.innerHTML = html;
  }
  function addLog(el2, msg, level = "info") {
    const tag = "[AAD]";
    const consoleFn = level === "err" ? console.error : level === "warn" ? console.warn : level === "ok" ? console.info : console.log;
    consoleFn(`${tag} ${msg}`);
    const timeStr = ts();
    appendLogToStore(`[${timeStr}] [${level}] ${msg}`);
    const entry = document.createElement("div");
    entry.className = "aad-log-entry";
    entry.innerHTML = `<span class="aad-log-time">${timeStr}</span> <span class="aad-log-${level}">${esc(msg)}</span>`;
    el2.$log.appendChild(entry);
    el2.$log.scrollTop = el2.$log.scrollHeight;
    while (el2.$log.children.length > 200) {
      el2.$log.removeChild(el2.$log.firstChild);
    }
  }
  function restoreLogsToPanel(el2) {
    const lines = getStoredLogs();
    if (lines.length === 0) return;
    const recent = lines.slice(-50);
    const sep = document.createElement("div");
    sep.className = "aad-log-entry";
    sep.innerHTML = `<span class="aad-log-time">───</span> <span class="aad-log-info">── 以下为刷新前日志 (最近 ${recent.length}/${lines.length} 条) ──</span>`;
    el2.$log.appendChild(sep);
    recent.forEach((line) => {
      const m = line.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
      const entry = document.createElement("div");
      entry.className = "aad-log-entry";
      if (m) {
        entry.innerHTML = `<span class="aad-log-time">${esc(m[1])}</span> <span class="aad-log-${m[2]}">${esc(m[3])}</span>`;
      } else {
        entry.innerHTML = `<span class="aad-log-info">${esc(line)}</span>`;
      }
      el2.$log.appendChild(entry);
    });
    const sep2 = document.createElement("div");
    sep2.className = "aad-log-entry";
    sep2.innerHTML = `<span class="aad-log-time">───</span> <span class="aad-log-info">── 当前会话开始 ──</span>`;
    el2.$log.appendChild(sep2);
    el2.$log.scrollTop = el2.$log.scrollHeight;
  }
  function setControlsEnabled(el2, enabled) {
    const checkboxes = [el2.$chkSaveLog];
    checkboxes.forEach((cb) => {
      cb.disabled = !enabled;
      const label = cb.closest("label");
      if (label) label.classList.toggle("aad-disabled", !enabled);
    });
    el2.$intervalIn.disabled = !enabled;
    const wrap = el2.$intervalIn.closest("#aad-interval-wrap");
    if (wrap) wrap.classList.toggle("aad-disabled", !enabled);
    el2.$dlLogBtn.disabled = !enabled;
    el2.$dlLogBtn.classList.toggle("aad-disabled", !enabled);
  }
  const config = loadConfig();
  const state = createState();
  injectStyles();
  let el = null;
  let currentRunId = null;
  let skipInProgress = false;
  let skipCooldownUntil = 0;
  let versionBlocked = false;
  let disconnectSkipObserver = null;
  function log(msg, level) {
    if (el) addLog(el, msg, level);
    else console.log(`[AAD] ${msg}`);
  }
  function recordEvent(type, detail) {
    if (!state.startRunId) return;
    state.sessionEvents.push({ ts: Date.now(), type, detail });
    saveSession(state.startRunId, state);
  }
  function runIdMatches() {
    if (!state.startRunId) return false;
    const cur = parseUrl();
    return !!cur && cur.runId === state.startRunId;
  }
  function abortIfDrifted() {
    if (!state.running) return false;
    if (runIdMatches()) return true;
    const cur = parseUrl();
    const where = cur ? `${cur.owner}/${cur.repo}/runs/${cur.runId}` : location.pathname;
    log(`⚠️ URL drift: started on run #${state.startRunId} but now at ${where}`, "warn");
    log("⏹ Auto-stopped to avoid acting on the wrong action.", "err");
    if (el) setStatus(el, `⚠️ Stopped: URL changed away from run #${state.startRunId}`);
    stop();
    return false;
  }
  async function handleSkipDetected() {
    if (skipInProgress || !state.running) return;
    if (Date.now() < skipCooldownUntil) return;
    if (!abortIfDrifted()) return;
    skipInProgress = true;
    try {
      log('[detect] "Start all waiting jobs" button found in DOM');
      const cur = parseUrl();
      if (!cur) return;
      const ok = await trySkipWaitTimers(cur.owner, cur.repo, log, true);
      if (!abortIfDrifted()) return;
      if (ok) {
        log("✅ Click executed successfully", "ok");
        state.sessionApproved++;
        state.sessionSkipped++;
        state.totalApproved++;
        recordEvent("approve", 'Clicked "Start all waiting jobs"');
        if (el) renderCounters(el, state);
        saveSession(state.startRunId, state);
        skipCooldownUntil = Date.now() + 5e3;
      } else {
        log("⚠️ Click failed — will retry on next poll cycle", "warn");
        skipCooldownUntil = Date.now() + 15e3;
      }
    } catch (e) {
      log(`⚠️ Click error: ${e.message}`, "warn");
      skipCooldownUntil = Date.now() + 15e3;
    } finally {
      skipInProgress = false;
    }
  }
  function startSkipObserver() {
    stopSkipObserver();
    disconnectSkipObserver = observeSkipButton(handleSkipDetected);
  }
  function stopSkipObserver() {
    if (disconnectSkipObserver) {
      disconnectSkipObserver();
      disconnectSkipObserver = null;
    }
  }
  async function poll() {
    if (!state.running) return;
    if (!abortIfDrifted()) return;
    state.pollCycle++;
    saveRunningState(state.startRunId, true);
    const btnText = /start all waiting/i;
    const found = [...document.querySelectorAll(
      'button, [role="button"], summary'
    )].some((b) => btnText.test(b.textContent || ""));
    if (found && !skipInProgress && Date.now() >= skipCooldownUntil) {
      log(`[poll #${state.pollCycle}] button present — triggering click`);
      handleSkipDetected();
    } else {
      if (el) setStatus(el, `🔄 Monitoring (cycle ${state.pollCycle})...`);
    }
    if (state.running) {
      state.pollTimer = setTimeout(poll, config.interval * 1e3);
    }
  }
  function start() {
    if (versionBlocked) {
      log("⛔ Cannot start: outdated version. Please update first.", "err");
      return;
    }
    const cur = parseUrl();
    if (!cur) {
      log("⚠️ Not on an action run page", "warn");
      return;
    }
    state.running = true;
    state.startRunId = cur.runId;
    state.sessionApproved = 0;
    state.sessionSkipped = 0;
    state.sessionEvents = [];
    state.lastSkipKey = "";
    state.pollCycle = 0;
    state.monitorStartedAt = Date.now();
    clearSession(cur.runId);
    saveRunningState(cur.runId, true);
    if (el) el.$summary.style.display = "none";
    recordEvent("start", `Started on run #${cur.runId} (interval=${config.interval}s)`);
    log(`🚀 Started monitoring run #${cur.runId} (interval=${config.interval}s)`);
    if (el) renderToggle(el, true);
    startSkipObserver();
    poll();
  }
  function resume() {
    if (versionBlocked) {
      log("⛔ Cannot resume: outdated version. Please update first.", "err");
      return;
    }
    const cur = parseUrl();
    if (!cur) return;
    state.running = true;
    state.startRunId = cur.runId;
    loadSession(cur.runId, state);
    saveRunningState(cur.runId, true);
    if (el) el.$summary.style.display = "none";
    recordEvent("resume", `Resumed after page refresh`);
    log(`🚀 Resumed monitoring run #${cur.runId} (interval=${config.interval}s)`);
    if (el) {
      renderToggle(el, true);
      renderCounters(el, state);
    }
    startSkipObserver();
    poll();
  }
  function stop() {
    state.running = false;
    if (state.startRunId) saveRunningState(state.startRunId, false);
    stopSkipObserver();
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
    log(`⏹ Stopped (cycles=${state.pollCycle}, clicks=${state.sessionApproved})`);
    if (state.startRunId) saveSession(state.startRunId, state);
    if (el) renderToggle(el, false);
  }
  function bindPanelEvents(panel, runId) {
    panel.$toggleBtn.addEventListener("click", () => {
      state.running ? stop() : start();
    });
    panel.$intervalIn.addEventListener("change", () => {
      config.interval = Math.max(5, parseInt(panel.$intervalIn.value, 10) || 15);
      panel.$intervalIn.value = String(config.interval);
      saveConfigField("interval", config.interval);
    });
    panel.$chkSaveLog.addEventListener("change", () => {
      config.saveLog = panel.$chkSaveLog.checked;
      saveConfigField("saveLog", config.saveLog);
      setLogSaving(config.saveLog);
      panel.$logPath.style.display = config.saveLog ? "block" : "none";
      log(config.saveLog ? `💾 日志记录已开启 — 文件: aad-run-${runId}.log` : "💾 日志记录已关闭", config.saveLog ? "ok" : "info");
    });
    panel.$dlLogBtn.addEventListener("click", () => downloadLog(runId));
  }
  function buildPanelFor(params) {
    initLogStore(params.runId, config.saveLog);
    el = buildUI(params.runId, config);
    bindPanelEvents(el, params.runId);
    renderRunInfo(el, {
      owner: params.owner,
      repo: params.repo,
      runId: params.runId,
      workflow: getWorkflowName() || "Deploy (PRD)"
    });
    log(`Ready — ${params.owner}/${params.repo} run #${params.runId}`);
    if (config.saveLog) restoreLogsToPanel(el);
    currentRunId = params.runId;
    runVersionCheck();
    if (wasRunning(params.runId)) {
      log("🔄 Resuming after page refresh...", "ok");
      resume();
    }
  }
  function teardownPanel() {
    if (state.running) stop();
    if (el) {
      el.panel.remove();
      el.tab.remove();
      el = null;
    }
    currentRunId = null;
  }
  async function runVersionCheck() {
    if (!el) return;
    const currentVersion = getCurrentVersion();
    try {
      const v = await checkLatestVersion(currentVersion);
      if (v.outdated) {
        versionBlocked = true;
        const installUrl = `https://github.com/TD-Yofun/talkdesk-auto-deploy/releases/latest/download/auto-approve-deploy.min.user.js`;
        const notesHtml = v.releaseNotes ? `<details open style="margin-top:8px"><summary style="cursor:pointer;color:#7d8590;font-size:11px">📋 v${esc(v.latest)} 更新内容</summary>
             <div style="margin-top:4px;padding:6px 8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;font-size:11px;line-height:1.5;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-word">${esc(v.releaseNotes)}</div>
           </details>` : "";
        el.$info.innerHTML = `<div style="color:#f85149;font-weight:600">⛔ 脚本版本过期，请更新后使用</div>
        <div style="margin-top:4px;font-size:11px">当前: <code>${esc(v.current)}</code> · 最新: <code>${esc(v.latest)}</code></div>
        <div style="margin-top:8px">
          <a href="${esc(installUrl)}" target="_blank" rel="noopener" style="display:inline-block;padding:6px 12px;background:#238636;color:#fff;border-radius:4px;text-decoration:none;font-weight:600">📥 安装最新版本</a>
          <a href="${esc(v.releaseUrl)}" target="_blank" rel="noopener" style="margin-left:8px;color:#58a6ff;font-size:11px">查看 Release 页</a>
        </div>
        ${notesHtml}`;
        log(`⛔ Outdated: ${v.current} → ${v.latest}. Update required.`, "err");
        el.$toggleBtn.disabled = true;
        el.$toggleBtn.textContent = "⛔ Outdated";
        el.$intervalIn.disabled = true;
        el.$chkSaveLog.disabled = true;
        el.$dlLogBtn.disabled = true;
        return;
      }
      log(`✅ Version check passed (${v.current})`, "ok");
    } catch (e) {
      log(`⚠️ Version check failed: ${e.message} — proceeding anyway`, "warn");
    }
  }
  function checkPage() {
    const params = parseUrl();
    const onTarget = !!params && isDeployPRDPage();
    if (!onTarget) {
      if (el) teardownPanel();
      return;
    }
    if (!el || currentRunId !== params.runId) {
      if (el) teardownPanel();
      buildPanelFor(params);
    }
  }
  checkPage();
  let initialTries = 0;
  const initialPoll = setInterval(() => {
    initialTries++;
    checkPage();
    if (el || initialTries >= 20) clearInterval(initialPoll);
  }, 500);
  document.addEventListener("turbo:load", () => checkPage());
  document.addEventListener("turbo:render", () => checkPage());
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(checkPage, 400);
    }
  }, 1e3);
  GM_registerMenuCommand("🚀 Start Monitoring", () => {
    if (el) start();
  });
  GM_registerMenuCommand("⏹ Stop Monitoring", () => {
    if (el) stop();
  });

})();