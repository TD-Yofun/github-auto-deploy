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
// @grant        GM_deleteValue
// @grant        GM_getValue
// @grant        GM_info
// @grant        GM_listValues
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        window.focus
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
  const WATCHDOG_TIMEOUT_MS = 10 * 60 * 1e3;
  function createState() {
    return {
      running: false,
      paused: false,
      pollTimer: null,
      startRunId: null,
      sessionApproved: 0,
      totalApproved: 0,
      lastSkipKey: "",
      monitorStartedAt: 0,
      pollCycle: 0,
      sessionSkipped: 0,
      sessionEvents: [],
      lastProgressAt: 0
    };
  }
  let _logBuffer = [];
  let _logFlushTimer = null;
  let _logStoreKey = "";
  function initLogStore(runId) {
    _logStoreKey = `aad_log_${runId}`;
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
    if (!_logStoreKey) return;
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
      lastSkipKey: state2.lastSkipKey,
      lastProgressAt: state2.lastProgressAt
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
    state2.lastProgressAt = s.lastProgressAt || 0;
    return true;
  }
  function clearSession(runId) {
    const sessionKey = `aad_session_${runId}`;
    GM_setValue(sessionKey, null);
  }
  let worker = null;
  let fallbackTimer = null;
  let currentCb = null;
  function createWorker() {
    try {
      const src = `let t=null;self.onmessage=(e)=>{const d=e.data;if(d&&d.type==='start'){if(t)clearTimeout(t);t=setTimeout(()=>self.postMessage('tick'),d.ms);}else if(d&&d.type==='stop'){if(t)clearTimeout(t);t=null;}};`;
      const blob = new Blob([src], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      return w;
    } catch {
      return null;
    }
  }
  function scheduleTick(cb, ms) {
    currentCb = cb;
    if (!worker) worker = createWorker();
    if (worker) {
      worker.onmessage = () => {
        if (currentCb) currentCb();
      };
      worker.postMessage({ type: "start", ms });
    } else {
      if (fallbackTimer) clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(() => {
        if (currentCb) currentCb();
      }, ms);
    }
  }
  function cancelTick() {
    currentCb = null;
    if (worker) worker.postMessage({ type: "stop" });
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
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
  function formatDuration(ms) {
    const secs = Math.floor(ms / 1e3);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    if (mins < 60) return `${mins}m ${remSecs}s`;
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours}h ${remMins}m`;
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
    #aad-pause-btn {
      padding: 5px 12px;
      border: 1px solid #30363d;
      border-radius: 6px;
      background: #21262d;
      color: #e6edf3;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    #aad-pause-btn:hover { background: #30363d; }
    #aad-pause-btn[hidden] { display: none !important; }
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
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .aad-summary-header .aad-summary-actions {
      display: flex;
      gap: 6px;
    }
    .aad-summary-header button {
      background: #21262d;
      border: 1px solid #30363d;
      color: #e6edf3;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      cursor: pointer;
    }
    .aad-summary-header button:hover { background: #30363d; }
    .aad-summary-header button.aad-copied { background: #238636; border-color: #2ea043; }
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

    /* ── Overview Widget (Actions list pages) ─────────────── */
    #aad-overview {
      position: fixed !important;
      bottom: 16px; right: 16px;
      width: 320px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 12px;
      z-index: 2147483646 !important;
      box-shadow: 0 4px 16px rgba(0,0,0,.4);
      overflow: hidden;
    }
    #aad-overview .aad-ov-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: #0d1117;
      border-bottom: 1px solid #30363d;
      font-weight: 600;
    }
    #aad-overview .aad-ov-close {
      background: none; border: none; color: #8b949e; cursor: pointer;
      font-size: 16px; line-height: 1; padding: 0 4px;
    }
    #aad-overview .aad-ov-close:hover { color: #e6edf3; }
    #aad-overview .aad-ov-body {
      max-height: 240px;
      overflow-y: auto;
      padding: 4px 0;
    }
    #aad-overview .aad-ov-item {
      padding: 6px 12px;
      border-bottom: 1px solid #21262d;
    }
    #aad-overview .aad-ov-item:last-child { border-bottom: none; }
    #aad-overview .aad-ov-link {
      color: #58a6ff;
      text-decoration: none;
      display: block;
      font-size: 12px;
      word-break: break-all;
    }
    #aad-overview .aad-ov-link:hover { text-decoration: underline; }
    #aad-overview .aad-ov-meta {
      display: block;
      margin-top: 2px;
      color: #8b949e;
      font-size: 11px;
    }
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
        <button id="aad-pause-btn" hidden>⏸ Pause</button>
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
      $pauseBtn: document.getElementById("aad-pause-btn"),
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
  function renderToggle(el2, running, paused = false) {
    if (running) {
      el2.$toggleBtn.textContent = "⏹ Stop";
      el2.$toggleBtn.className = "stop";
      el2.$pauseBtn.hidden = false;
      el2.$pauseBtn.textContent = paused ? "▶ Resume" : "⏸ Pause";
      setControlsEnabled(el2, false);
    } else {
      el2.$toggleBtn.textContent = "▶ Start";
      el2.$toggleBtn.className = "start";
      el2.$pauseBtn.hidden = true;
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
  function summaryToMarkdown(state2, config2, conclusion, info) {
    const duration = Date.now() - state2.monitorStartedAt;
    const head = (info == null ? void 0 : info.workflow) ? `## 📊 ${info.workflow} — Run #${info.runId || ""}` : `## 📊 执行报告`;
    const where = (info == null ? void 0 : info.owner) && (info == null ? void 0 : info.repo) ? `
**Repository:** ${info.owner}/${info.repo}` + (info.runId ? `  
**Run:** [#${info.runId}](https://github.com/${info.owner}/${info.repo}/actions/runs/${info.runId})` : "") : "";
    const lines = [
      head,
      where,
      "",
      `- **结果:** ${conclusion}`,
      `- **总耗时:** ${formatDuration(duration)}`,
      `- **轮询次数:** ${state2.pollCycle}`,
      `- **审批通过:** ${state2.sessionApproved}`,
      `- **跳过计时器:** ${state2.sessionSkipped}`,
      `- **轮询间隔:** ${config2.interval}s`,
      `- **开始时间:** ${new Date(state2.monitorStartedAt).toLocaleString()}`
    ];
    if (state2.sessionEvents.length > 0) {
      lines.push("", "### 📋 执行时间线", "");
      state2.sessionEvents.forEach((ev) => {
        const t = new Date(ev.ts).toLocaleTimeString("en-US", { hour12: false });
        const icon = ev.type === "approve" ? "✅" : ev.type === "skip" ? "⏭" : ev.type === "error" ? "❌" : ev.type === "start" ? "🚀" : ev.type === "resume" ? "🔄" : ev.type === "complete" ? "🏁" : "📌";
        lines.push(`- \`${t}\` ${icon} ${ev.detail}`);
      });
    }
    return lines.join("\n") + "\n";
  }
  function generateSummary(el2, state2, config2, conclusion, info) {
    const duration = Date.now() - state2.monitorStartedAt;
    const timelineHtml = state2.sessionEvents.map((ev) => {
      const t = new Date(ev.ts).toLocaleTimeString("en-US", { hour12: false });
      const icon = ev.type === "approve" ? "✅" : ev.type === "skip" ? "⏭" : ev.type === "error" ? "❌" : ev.type === "start" ? "🚀" : ev.type === "resume" ? "🔄" : ev.type === "complete" ? "🏁" : "📌";
      return `<div class="aad-timeline-item"><span class="aad-log-time">${t}</span> ${icon} ${esc(ev.detail)}</div>`;
    }).join("");
    const ok = conclusion === "success";
    const statusIcon = ok ? "✅" : "❌";
    const statusClass = ok ? "aad-log-ok" : "aad-log-err";
    el2.$summary.innerHTML = `
    <div class="aad-summary-header">
      <span>📊 执行报告</span>
      <span class="aad-summary-actions">
        <button id="aad-copy-summary-btn" title="复制为 Markdown">📋 Copy MD</button>
      </span>
    </div>
    <div class="aad-summary-grid">
      <div class="aad-summary-item">
        <span class="aad-summary-label">结果</span>
        <span class="${statusClass}">${statusIcon} ${esc(conclusion)}</span>
      </div>
      <div class="aad-summary-item">
        <span class="aad-summary-label">总耗时</span>
        <span>${formatDuration(duration)}</span>
      </div>
      <div class="aad-summary-item">
        <span class="aad-summary-label">轮询次数</span>
        <span>${state2.pollCycle}</span>
      </div>
      <div class="aad-summary-item">
        <span class="aad-summary-label">审批通过</span>
        <span class="aad-log-ok">${state2.sessionApproved}</span>
      </div>
      <div class="aad-summary-item">
        <span class="aad-summary-label">跳过计时器</span>
        <span>${state2.sessionSkipped}</span>
      </div>
      <div class="aad-summary-item">
        <span class="aad-summary-label">轮询间隔</span>
        <span>${config2.interval}s</span>
      </div>
    </div>
    ${state2.sessionEvents.length > 0 ? `
      <div class="aad-summary-header" style="margin-top:8px"><span>📋 执行时间线</span></div>
      <div class="aad-timeline">${timelineHtml}</div>
    ` : ""}
  `;
    el2.$summary.style.display = "block";
    const copyBtn = el2.$summary.querySelector("#aad-copy-summary-btn");
    copyBtn == null ? void 0 : copyBtn.addEventListener("click", async () => {
      const md = summaryToMarkdown(state2, config2, conclusion, info);
      try {
        await navigator.clipboard.writeText(md);
        copyBtn.textContent = "✓ Copied!";
        copyBtn.classList.add("aad-copied");
        setTimeout(() => {
          copyBtn.textContent = "📋 Copy MD";
          copyBtn.classList.remove("aad-copied");
        }, 1500);
      } catch {
        window.prompt("复制以下 Markdown:", md);
      }
    });
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
  const STALE_MS = 30 * 60 * 1e3;
  const WIDGET_ID = "aad-overview";
  function listActiveRuns() {
    if (typeof GM_listValues !== "function") return [];
    const now = Date.now();
    const out = [];
    for (const key of GM_listValues()) {
      if (!key.startsWith("aad_running_")) continue;
      const ts2 = GM_getValue(key, 0);
      if (!ts2 || now - ts2 > STALE_MS) continue;
      const runId = key.slice("aad_running_".length);
      const session = GM_getValue(`aad_session_${runId}`, null);
      const meta = GM_getValue(`aad_meta_${runId}`, null);
      out.push({
        runId,
        startedAt: (session == null ? void 0 : session.startedAt) || ts2,
        approved: (session == null ? void 0 : session.approved) || 0,
        url: meta == null ? void 0 : meta.url,
        owner: meta == null ? void 0 : meta.owner,
        repo: meta == null ? void 0 : meta.repo,
        workflow: meta == null ? void 0 : meta.workflow
      });
    }
    return out.sort((a, b) => b.startedAt - a.startedAt);
  }
  function saveRunMeta(runId, meta) {
    GM_setValue(`aad_meta_${runId}`, {
      ...meta,
      url: `https://github.com/${meta.owner}/${meta.repo}/actions/runs/${runId}`
    });
  }
  function renderWidget(runs) {
    var _a;
    let widget = document.getElementById(WIDGET_ID);
    if (runs.length === 0) {
      if (widget) widget.remove();
      return;
    }
    if (!widget) {
      widget = document.createElement("div");
      widget.id = WIDGET_ID;
      document.body.appendChild(widget);
    }
    const now = Date.now();
    const items = runs.map((r) => {
      const elapsed = formatDuration(now - r.startedAt);
      const label = r.workflow && r.owner && r.repo ? `${esc(r.owner)}/${esc(r.repo)} · ${esc(r.workflow)} #${esc(r.runId)}` : `Run #${esc(r.runId)}`;
      const href = r.url || `#`;
      return `<div class="aad-ov-item">
      <a href="${esc(href)}" class="aad-ov-link">${label}</a>
      <span class="aad-ov-meta">⏱ ${elapsed} · ✅ ${r.approved || 0}</span>
    </div>`;
    }).join("");
    widget.innerHTML = `
    <div class="aad-ov-header">
      <span>🚀 AAD · ${runs.length} active</span>
      <button class="aad-ov-close" title="Hide">×</button>
    </div>
    <div class="aad-ov-body">${items}</div>
  `;
    (_a = widget.querySelector(".aad-ov-close")) == null ? void 0 : _a.addEventListener("click", () => widget.remove());
  }
  let refreshTimer = null;
  function mountOverviewWidget(isOnRunPage) {
    var _a;
    if (isOnRunPage) {
      (_a = document.getElementById(WIDGET_ID)) == null ? void 0 : _a.remove();
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      return;
    }
    const tick = () => renderWidget(listActiveRuns());
    tick();
    if (!refreshTimer) refreshTimer = setInterval(tick, 5e3);
  }
  function clearRunMeta(runId) {
    if (typeof GM_deleteValue === "function") GM_deleteValue(`aad_meta_${runId}`);
  }
  const config = loadConfig();
  const state = createState();
  injectStyles();
  let el = null;
  let currentRunId = null;
  let currentMeta = null;
  let skipInProgress = false;
  let skipCooldownUntil = 0;
  let versionBlocked = false;
  let disconnectSkipObserver = null;
  window.addEventListener("error", (e) => {
    var _a;
    const msg = ((_a = e.error) == null ? void 0 : _a.stack) || e.message || String(e);
    if (/aad|auto[-_]?approve/i.test(msg) || (e.filename || "").includes("user.js")) {
      log(`💥 Uncaught error: ${msg.slice(0, 300)}`, "err");
    }
  });
  window.addEventListener("unhandledrejection", (e) => {
    var _a, _b;
    const reason = ((_a = e.reason) == null ? void 0 : _a.stack) || ((_b = e.reason) == null ? void 0 : _b.message) || String(e.reason);
    log(`💥 Unhandled rejection: ${String(reason).slice(0, 300)}`, "err");
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      log("🔄 Page restored from bfcache — re-checking");
      setTimeout(checkPage, 200);
    }
  });
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
    if (skipInProgress || !state.running || state.paused) return;
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
        state.lastProgressAt = Date.now();
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
    if (state.paused) {
      scheduleTick(poll, config.interval * 1e3);
      return;
    }
    if (!abortIfDrifted()) return;
    state.pollCycle++;
    saveRunningState(state.startRunId, true);
    const conclusion = readRunConclusion();
    if (isTerminalConclusion(conclusion)) {
      log(`🏁 Workflow ${conclusion} — stopping and generating report`, "ok");
      stop(false);
      return;
    }
    if (state.lastProgressAt > 0 && Date.now() - state.lastProgressAt >= WATCHDOG_TIMEOUT_MS) {
      const mins = Math.round(WATCHDOG_TIMEOUT_MS / 6e4);
      log(`⏱️ Watchdog: no progress for ${mins} min — reloading page to recover...`, "warn");
      recordEvent("error", `Watchdog reload after ${mins} min of no progress`);
      saveSession(state.startRunId, state);
      saveRunningState(state.startRunId, true);
      setTimeout(() => location.reload(), 300);
      return;
    }
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
      scheduleTick(poll, config.interval * 1e3);
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
    state.paused = false;
    state.startRunId = cur.runId;
    state.sessionApproved = 0;
    state.sessionSkipped = 0;
    state.sessionEvents = [];
    state.lastSkipKey = "";
    state.pollCycle = 0;
    state.monitorStartedAt = Date.now();
    state.lastProgressAt = Date.now();
    clearSession(cur.runId);
    saveRunningState(cur.runId, true);
    if (currentMeta) saveRunMeta(cur.runId, currentMeta);
    if (el) el.$summary.style.display = "none";
    recordEvent("start", `Started on run #${cur.runId} (interval=${config.interval}s)`);
    log(`🚀 Started monitoring run #${cur.runId} (interval=${config.interval}s)`);
    if (el) renderToggle(el, true, false);
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
    state.paused = false;
    state.startRunId = cur.runId;
    loadSession(cur.runId, state);
    if (!state.lastProgressAt) state.lastProgressAt = Date.now();
    saveRunningState(cur.runId, true);
    if (currentMeta) saveRunMeta(cur.runId, currentMeta);
    if (el) el.$summary.style.display = "none";
    recordEvent("resume", `Resumed after page refresh`);
    log(`🚀 Resumed monitoring run #${cur.runId} (interval=${config.interval}s)`);
    if (el) {
      renderToggle(el, true, false);
      renderCounters(el, state);
    }
    startSkipObserver();
    poll();
  }
  function pauseMonitoring() {
    if (!state.running || state.paused) return;
    state.paused = true;
    stopSkipObserver();
    cancelTick();
    log("⏸ Paused — click Resume to continue", "warn");
    if (state.startRunId) saveSession(state.startRunId, state);
    if (el) {
      renderToggle(el, true, true);
      setStatus(el, "⏸ Paused");
    }
    scheduleTick(poll, config.interval * 1e3);
  }
  function resumeMonitoring() {
    if (!state.running || !state.paused) return;
    state.paused = false;
    state.lastProgressAt = Date.now();
    log("▶ Resumed", "ok");
    if (el) renderToggle(el, true, false);
    startSkipObserver();
    poll();
  }
  function readRunConclusion() {
    const svg = document.querySelector(
      ".actions-workflow-runs-status svg[aria-label]"
    );
    const label = ((svg == null ? void 0 : svg.getAttribute("aria-label")) || "").toLowerCase();
    if (label) {
      if (/success/.test(label)) return "success";
      if (/failure|failed/.test(label)) return "failure";
      if (/cancel/.test(label)) return "cancelled";
      if (/timed.?out/.test(label)) return "timed_out";
      if (/skipped/.test(label)) return "skipped";
      if (/action.?required/.test(label)) return "action_required";
      if (/in progress|queued|waiting|pending|requested/.test(label)) return "in_progress";
    }
    const cls = (svg == null ? void 0 : svg.getAttribute("class")) || "";
    if (/color-fg-success/.test(cls)) return "success";
    if (/color-fg-danger/.test(cls)) return "failure";
    if (/color-fg-muted/.test(cls)) return "cancelled";
    return "";
  }
  function isTerminalConclusion(c) {
    return c === "success" || c === "failure" || c === "cancelled" || c === "timed_out" || c === "skipped";
  }
  function stop(manual = true) {
    state.running = false;
    state.paused = false;
    if (state.startRunId) saveRunningState(state.startRunId, false);
    if (state.startRunId) clearRunMeta(state.startRunId);
    stopSkipObserver();
    cancelTick();
    log(`⏹ Stopped (cycles=${state.pollCycle}, clicks=${state.sessionApproved})`);
    const conclusion = readRunConclusion() || (manual ? "stopped" : "unknown");
    recordEvent("complete", `Stopped — ${conclusion} (duration=${Math.round((Date.now() - state.monitorStartedAt) / 1e3)}s)`);
    if (state.startRunId) saveSession(state.startRunId, state);
    if (el) {
      renderToggle(el, false);
      generateSummary(el, state, config, conclusion, currentMeta || void 0);
    }
    notifyCompletion(conclusion, manual);
  }
  function notifyCompletion(conclusion, manual) {
    if (manual && conclusion === "stopped") return;
    try {
      const icon = conclusion === "success" ? "✅" : conclusion === "failure" ? "❌" : conclusion === "cancelled" ? "⚠️" : "🏁";
      const where = currentMeta ? `${currentMeta.owner}/${currentMeta.repo}` : "workflow";
      const text = `Run #${(currentMeta == null ? void 0 : currentMeta.runId) || state.startRunId || ""} — ${conclusion}
✅ ${state.sessionApproved} · ⏱ ${Math.round((Date.now() - state.monitorStartedAt) / 1e3)}s`;
      GM_notification({
        title: `${icon} AAD — ${where}`,
        text,
        timeout: 1e4,
        onclick: () => {
          try {
            window.focus();
          } catch {
          }
        }
      });
    } catch (e) {
      log(`Notification failed: ${e.message}`, "warn");
    }
  }
  function bindPanelEvents(panel, runId) {
    panel.$toggleBtn.addEventListener("click", () => {
      state.running ? stop() : start();
    });
    panel.$pauseBtn.addEventListener("click", () => {
      state.paused ? resumeMonitoring() : pauseMonitoring();
    });
    panel.$intervalIn.addEventListener("change", () => {
      config.interval = Math.max(5, parseInt(panel.$intervalIn.value, 10) || 15);
      panel.$intervalIn.value = String(config.interval);
      saveConfigField("interval", config.interval);
    });
    panel.$chkSaveLog.addEventListener("change", () => {
      config.saveLog = panel.$chkSaveLog.checked;
      saveConfigField("saveLog", config.saveLog);
      panel.$logPath.style.display = config.saveLog ? "block" : "none";
      log(config.saveLog ? `💾 日志记录已开启 — 文件: aad-run-${runId}.log` : "💾 日志记录已关闭", config.saveLog ? "ok" : "info");
    });
    panel.$dlLogBtn.addEventListener("click", () => downloadLog(runId));
  }
  function buildPanelFor(params) {
    initLogStore(params.runId);
    el = buildUI(params.runId, config);
    bindPanelEvents(el, params.runId);
    const workflow = getWorkflowName() || "Deploy (PRD)";
    currentMeta = { owner: params.owner, repo: params.repo, runId: params.runId, workflow };
    renderRunInfo(el, currentMeta);
    log(`Ready — ${params.owner}/${params.repo} run #${params.runId}`);
    restoreLogsToPanel(el);
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
    currentMeta = null;
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
      mountOverviewWidget(false);
      return;
    }
    if (!el || currentRunId !== params.runId) {
      if (el) teardownPanel();
      buildPanelFor(params);
    }
    mountOverviewWidget(true);
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