/**
 * Main entry — DOM-based "Start all waiting jobs" auto-clicker
 *
 * No GitHub token required. Detects the break-glass button on the page and
 * clicks through the dialog. Only activates on Deploy (PRD) workflow runs.
 */
import { parseUrl, isDeployPRDPage, getWorkflowName, type RunParams } from './utils/url';
import { loadConfig, saveConfigField } from './core/config';
import { createState, type State } from './core/state';
import { initLogStore, setLogSaving, downloadLog } from './core/log-store';
import { saveRunningState, wasRunning, saveSession, loadSession, clearSession } from './core/session';
import { trySkipWaitTimers, observeSkipButton } from './api/skip-timers';
import { checkLatestVersion, getCurrentVersion } from './core/version-check';
import { esc } from './utils/helpers';
import { injectStyles } from './ui/styles';
import {
  buildUI, renderRunInfo, renderToggle, renderCounters,
  setStatus, addLog, restoreLogsToPanel, generateSummary,
  type UIElements,
} from './ui/ui';

const config = loadConfig();
const state: State = createState();
injectStyles();

let el: UIElements | null = null;
let currentRunId: string | null = null;
let skipInProgress = false;
let skipCooldownUntil = 0;
let versionBlocked = false;
let disconnectSkipObserver: (() => void) | null = null;

// ── Helpers ────────────────────────────────────────────────
function log(msg: string, level?: string): void {
  if (el) addLog(el, msg, level);
  else console.log(`[AAD] ${msg}`);
}

function recordEvent(type: string, detail: string): void {
  if (!state.startRunId) return;
  state.sessionEvents.push({ ts: Date.now(), type, detail });
  saveSession(state.startRunId, state);
}

// ── RunId guard ────────────────────────────────────────────
/** Returns true if the current page URL still matches the run we started on. */
function runIdMatches(): boolean {
  if (!state.startRunId) return false;
  const cur = parseUrl();
  return !!cur && cur.runId === state.startRunId;
}

function abortIfDrifted(): boolean {
  if (!state.running) return false;
  if (runIdMatches()) return true;
  const cur = parseUrl();
  const where = cur ? `${cur.owner}/${cur.repo}/runs/${cur.runId}` : location.pathname;
  log(`⚠️ URL drift: started on run #${state.startRunId} but now at ${where}`, 'warn');
  log('⏹ Auto-stopped to avoid acting on the wrong action.', 'err');
  if (el) setStatus(el, `⚠️ Stopped: URL changed away from run #${state.startRunId}`);
  stop();
  return false;
}

// ── Skip-button observer & poll ────────────────────────────
async function handleSkipDetected(): Promise<void> {
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
      log('✅ Click executed successfully', 'ok');
      state.sessionApproved++;
      state.sessionSkipped++;
      state.totalApproved++;
      recordEvent('approve', 'Clicked "Start all waiting jobs"');
      if (el) renderCounters(el, state);
      saveSession(state.startRunId!, state);
      // brief cooldown to avoid double-firing
      skipCooldownUntil = Date.now() + 5_000;
    } else {
      log('⚠️ Click failed — will retry on next poll cycle', 'warn');
      skipCooldownUntil = Date.now() + 15_000;
    }
  } catch (e) {
    log(`⚠️ Click error: ${(e as Error).message}`, 'warn');
    skipCooldownUntil = Date.now() + 15_000;
  } finally {
    skipInProgress = false;
  }
}

function startSkipObserver(): void {
  stopSkipObserver();
  disconnectSkipObserver = observeSkipButton(handleSkipDetected);
}

function stopSkipObserver(): void {
  if (disconnectSkipObserver) {
    disconnectSkipObserver();
    disconnectSkipObserver = null;
  }
}

// ── Periodic poll (fallback: detect when observer misses) ──
async function poll(): Promise<void> {
  if (!state.running) return;
  if (!abortIfDrifted()) return;

  state.pollCycle++;
  saveRunningState(state.startRunId!, true);

  // Check DOM for the button as fallback
  const btnText = /start all waiting/i;
  const found = [...document.querySelectorAll<HTMLElement>(
    'button, [role="button"], summary'
  )].some((b) => btnText.test(b.textContent || ''));

  if (found && !skipInProgress && Date.now() >= skipCooldownUntil) {
    log(`[poll #${state.pollCycle}] button present — triggering click`);
    handleSkipDetected();
  } else {
    if (el) setStatus(el, `🔄 Monitoring (cycle ${state.pollCycle})...`);
  }

  if (state.running) {
    state.pollTimer = setTimeout(poll, config.interval * 1000);
  }
}

// ── Lifecycle ──────────────────────────────────────────────
function start(): void {
  if (versionBlocked) {
    log('⛔ Cannot start: outdated version. Please update first.', 'err');
    return;
  }
  const cur = parseUrl();
  if (!cur) {
    log('⚠️ Not on an action run page', 'warn');
    return;
  }
  state.running = true;
  state.startRunId = cur.runId;
  state.sessionApproved = 0;
  state.sessionSkipped = 0;
  state.sessionEvents = [];
  state.lastSkipKey = '';
  state.pollCycle = 0;
  state.monitorStartedAt = Date.now();
  clearSession(cur.runId);
  saveRunningState(cur.runId, true);
  if (el) el.$summary.style.display = 'none';
  recordEvent('start', `Started on run #${cur.runId} (interval=${config.interval}s)`);
  log(`🚀 Started monitoring run #${cur.runId} (interval=${config.interval}s)`);
  if (el) renderToggle(el, true);
  startSkipObserver();
  poll();
}

function resume(): void {
  if (versionBlocked) {
    log('⛔ Cannot resume: outdated version. Please update first.', 'err');
    return;
  }
  const cur = parseUrl();
  if (!cur) return;
  state.running = true;
  state.startRunId = cur.runId;
  loadSession(cur.runId, state);
  saveRunningState(cur.runId, true);
  if (el) el.$summary.style.display = 'none';
  recordEvent('resume', `Resumed after page refresh`);
  log(`🚀 Resumed monitoring run #${cur.runId} (interval=${config.interval}s)`);
  if (el) {
    renderToggle(el, true);
    renderCounters(el, state);
  }
  startSkipObserver();
  poll();
}

function stop(): void {
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

// ── Panel build/teardown (driven by page detection) ────────
function bindPanelEvents(panel: UIElements, runId: string): void {
  panel.$toggleBtn.addEventListener('click', () => {
    state.running ? stop() : start();
  });

  panel.$intervalIn.addEventListener('change', () => {
    config.interval = Math.max(5, parseInt(panel.$intervalIn.value, 10) || 15);
    panel.$intervalIn.value = String(config.interval);
    saveConfigField('interval', config.interval);
  });

  panel.$chkSaveLog.addEventListener('change', () => {
    config.saveLog = panel.$chkSaveLog.checked;
    saveConfigField('saveLog', config.saveLog);
    setLogSaving(config.saveLog);
    panel.$logPath.style.display = config.saveLog ? 'block' : 'none';
    log(config.saveLog ? `💾 日志记录已开启 — 文件: aad-run-${runId}.log` : '💾 日志记录已关闭', config.saveLog ? 'ok' : 'info');
  });

  panel.$dlLogBtn.addEventListener('click', () => downloadLog(runId));
}

function buildPanelFor(params: RunParams): void {
  initLogStore(params.runId, config.saveLog);
  el = buildUI(params.runId, config);
  bindPanelEvents(el, params.runId);
  renderRunInfo(el, {
    owner: params.owner,
    repo: params.repo,
    runId: params.runId,
    workflow: getWorkflowName() || 'Deploy (PRD)',
  });
  log(`Ready — ${params.owner}/${params.repo} run #${params.runId}`);
  if (config.saveLog) restoreLogsToPanel(el);
  currentRunId = params.runId;

  runVersionCheck();

  if (wasRunning(params.runId)) {
    log('🔄 Resuming after page refresh...', 'ok');
    resume();
  }
}

function teardownPanel(): void {
  if (state.running) stop();
  if (el) {
    el.panel.remove();
    el.tab.remove();
    el = null;
  }
  currentRunId = null;
}

async function runVersionCheck(): Promise<void> {
  if (!el) return;
  const currentVersion = getCurrentVersion();
  try {
    const v = await checkLatestVersion(currentVersion);
    if (v.outdated) {
      versionBlocked = true;
      el.$info.innerHTML = `<div style="color:#f85149;font-weight:600">⛔ 脚本版本过期，请更新后使用</div>
        <div style="margin-top:4px;font-size:11px">当前: <code>${esc(v.current)}</code> · 最新: <code>${esc(v.latest)}</code></div>
        <div style="margin-top:6px"><a href="${esc(v.releaseUrl)}" target="_blank" rel="noopener" style="color:#58a6ff">📥 点此下载最新版本</a></div>`;
      log(`⛔ Outdated: ${v.current} → ${v.latest}. Update required.`, 'err');
      el.$toggleBtn.disabled = true;
      el.$toggleBtn.textContent = '⛔ Outdated';
      return;
    }
    log(`✅ Version check passed (${v.current})`, 'ok');
  } catch (e) {
    log(`⚠️ Version check failed: ${(e as Error).message} — proceeding anyway`, 'warn');
  }
}

// ── SPA-aware page watcher ─────────────────────────────────
function checkPage(): void {
  const params = parseUrl();
  const onTarget = !!params && isDeployPRDPage();

  if (!onTarget) {
    if (el) teardownPanel();
    return;
  }

  // On target page
  if (!el || currentRunId !== params!.runId) {
    if (el) teardownPanel();
    buildPanelFor(params!);
  }
}

// Initial + repeated checks (page may load Deploy (PRD) header after document-idle)
checkPage();
let initialTries = 0;
const initialPoll = setInterval(() => {
  initialTries++;
  checkPage();
  if (el || initialTries >= 20) clearInterval(initialPoll);
}, 500);

// SPA navigation (Turbo)
document.addEventListener('turbo:load', () => checkPage());
document.addEventListener('turbo:render', () => checkPage());

// URL change fallback (covers history.pushState that doesn't fire turbo:load)
let lastHref = location.href;
setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    setTimeout(checkPage, 400);
  }
}, 1000);

// ── Tampermonkey menu commands ─────────────────────────────
GM_registerMenuCommand('🚀 Start Monitoring', () => { if (el) start(); });
GM_registerMenuCommand('⏹ Stop Monitoring', () => { if (el) stop(); });
