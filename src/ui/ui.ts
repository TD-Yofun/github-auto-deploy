/**
 * UI — build panel, bindEvents, render functions
 */
import { esc, ts, tsFull, formatDuration } from '../utils/helpers';
import { clockTime, eventIcon, reportToMarkdown, type Report } from '../core/report';
import { appendLogToStore, getStoredLogs } from '../core/log-store';
import { Config, saveConfigField } from '../core/config';
import type { State } from '../core/state';
import { ICON_CHEVRON_RIGHT, ICON_DOWNLOAD, ICON_SETTINGS } from './icons';

export interface UIElements {
  panel: HTMLDivElement;
  tab: HTMLDivElement;
  $info: HTMLElement;
  $toggleBtn: HTMLButtonElement;
  $pauseBtn: HTMLButtonElement;
  $dlLogBtn: HTMLButtonElement;
  $settingsBtn: HTMLButtonElement;
  $logPath: HTMLElement;
  $statusText: HTMLElement;
  $sessionCnt: HTMLElement;
  $totalCnt: HTMLElement;
  $log: HTMLElement;
  $summary: HTMLElement;
}

export function buildUI(runId: string, config: Config): UIElements {
  const panel = document.createElement('div') as HTMLDivElement;
  panel.id = 'aad-panel';
  panel.innerHTML = `
    <div id="aad-header">
      <span class="aad-title">Auto-Approve Deploy</span>
      <span class="aad-btns">
        <button id="aad-dl-log-btn" class="aad-icon-btn" title="Download log" aria-label="Download log">${ICON_DOWNLOAD}</button>
        <button id="aad-settings-btn" class="aad-icon-btn" title="Settings" aria-label="Settings">${ICON_SETTINGS}</button>
        <button id="aad-collapse-btn" class="aad-icon-btn" title="Collapse panel" aria-label="Collapse panel">${ICON_CHEVRON_RIGHT}</button>
      </span>
    </div>
    <div id="aad-body">
      <div id="aad-info">Loading run info...</div>
      <div id="aad-controls">
        <button id="aad-toggle-btn" class="aad-btn aad-btn--primary">Start</button>
        <button id="aad-pause-btn" class="aad-btn" hidden>Pause</button>
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

  const tab = document.createElement('div') as HTMLDivElement;
  tab.id = 'aad-tab';
  tab.className = 'shifted';
  tab.textContent = '◀ AAD';
  tab.setAttribute('role', 'button');
  tab.tabIndex = 0;
  tab.title = 'Toggle Auto-Approve Deploy panel';
  document.body.appendChild(tab);

  const el: UIElements = {
    panel,
    tab,
    $info: document.getElementById('aad-info')!,
    $toggleBtn: document.getElementById('aad-toggle-btn') as HTMLButtonElement,
    $pauseBtn: document.getElementById('aad-pause-btn') as HTMLButtonElement,
    $dlLogBtn: document.getElementById('aad-dl-log-btn') as HTMLButtonElement,
    $settingsBtn: document.getElementById('aad-settings-btn') as HTMLButtonElement,
    $logPath: document.getElementById('aad-log-path')!,
    $statusText: document.getElementById('aad-status-text')!,
    $sessionCnt: document.getElementById('aad-session-cnt')!,
    $totalCnt: document.getElementById('aad-total-cnt')!,
    $log: document.getElementById('aad-log')!,
    $summary: document.getElementById('aad-summary')!,
  };

  applyLogHint(el, config.saveLog);

  // Restore panel visibility from config
  if (!config.panelVisible) {
    panel.classList.add('collapsed');
    tab.classList.remove('shifted');
    tab.textContent = '◀ AAD';
  }

  // Collapse / Expand
  function togglePanel(): void {
    const isCollapsed = panel.classList.toggle('collapsed');
    tab.classList.toggle('shifted', !isCollapsed);
    tab.textContent = isCollapsed ? '◀ AAD' : '▶';
    config.panelVisible = !isCollapsed;
    saveConfigField('panelVisible', config.panelVisible);
  }
  tab.addEventListener('click', togglePanel);
  tab.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(); }
  });
  document.getElementById('aad-collapse-btn')!.addEventListener('click', togglePanel);

  return el;
}

export function renderRunInfo(el: UIElements, info: { owner: string; repo: string; runId: string; workflow: string; branch?: string }): void {
  el.$info.innerHTML = `
    <strong>${esc(info.owner)}/${esc(info.repo)}</strong><br>
    <span class="aad-run-name">${esc(info.workflow || 'Workflow')}</span>${info.branch ? ' · ' + esc(info.branch) : ''}<br>
    Run: <a class="aad-run-link" href="/${esc(info.owner)}/${esc(info.repo)}/actions/runs/${esc(info.runId)}">#${esc(info.runId)}</a>
  `;
}

export function renderToggle(el: UIElements, running: boolean, paused = false): void {
  el.$toggleBtn.textContent = running ? 'Stop' : 'Start';
  el.$toggleBtn.className = `aad-btn ${running ? 'aad-btn--danger' : 'aad-btn--primary'}`;
  el.$pauseBtn.hidden = !running;
  el.$pauseBtn.textContent = paused ? 'Resume' : 'Pause';
}

/** Show or hide the log-file hint (driven by the `saveLog` setting). */
export function applyLogHint(el: UIElements, visible: boolean): void {
  el.$logPath.classList.toggle('aad-visible', visible);
}

export function renderCounters(el: UIElements, state: State): void {
  el.$sessionCnt.textContent = String(state.sessionApproved);
  el.$totalCnt.textContent = String(state.totalApproved);
}

export function setStatus(el: UIElements, html: string): void {
  el.$statusText.innerHTML = html;
}

export function addLog(el: UIElements, msg: string, level = 'info'): void {
  const tag = '[AAD]';
  const consoleFn =
    level === 'err' ? console.error :
    level === 'warn' ? console.warn :
    level === 'ok' ? console.info : console.log;
  consoleFn(`${tag} ${msg}`);

  const timeStr = ts();
  // Persist with the full date so downloaded logs stay unambiguous across days.
  appendLogToStore(`[${tsFull()}] [${level}] ${msg}`);

  const entry = document.createElement('div');
  entry.className = 'aad-log-entry';
  entry.innerHTML = `<span class="aad-log-time">${timeStr}</span> <span class="aad-log-${level}">${esc(msg)}</span>`;
  // Only auto-scroll if user is already at (or near) the bottom — preserves
  // scroll position when the user has scrolled up to read history.
  const stickToBottom = el.$log.scrollHeight - el.$log.scrollTop - el.$log.clientHeight <= 20;
  el.$log.appendChild(entry);
  if (stickToBottom) el.$log.scrollTop = el.$log.scrollHeight;

  while (el.$log.children.length > 200) {
    el.$log.removeChild(el.$log.firstChild!);
  }
}

export function restoreLogsToPanel(el: UIElements): void {
  const lines = getStoredLogs();
  if (lines.length === 0) return;
  const maxRestore = 50;
  const recent = lines.slice(-maxRestore);

  const sep = document.createElement('div');
  sep.className = 'aad-log-entry';
  sep.innerHTML = `<span class="aad-log-time">───</span> <span class="aad-log-info">── 以下为刷新前日志 (最近 ${recent.length}/${lines.length} 条) ──</span>`;
  el.$log.appendChild(sep);

  recent.forEach((line) => {
    const m = line.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);
    const entry = document.createElement('div');
    entry.className = 'aad-log-entry';
    if (m) {
      entry.innerHTML = `<span class="aad-log-time">${esc(m[1].replace(/^\d{4}-\d{2}-\d{2} /, ''))}</span> <span class="aad-log-${m[2]}">${esc(m[3])}</span>`;
    } else {
      entry.innerHTML = `<span class="aad-log-info">${esc(line)}</span>`;
    }
    el.$log.appendChild(entry);
  });

  const sep2 = document.createElement('div');
  sep2.className = 'aad-log-entry';
  sep2.innerHTML = `<span class="aad-log-time">───</span> <span class="aad-log-info">── 当前会话开始 ──</span>`;
  el.$log.appendChild(sep2);
  el.$log.scrollTop = el.$log.scrollHeight;
}

export function generateSummary(el: UIElements, report: Report): void {
  const timelineHtml = report.events.map((ev) =>
    `<div class="aad-timeline-item"><span class="aad-log-time">${clockTime(ev.ts)}</span> ${eventIcon(ev.type)} ${esc(ev.detail)}</div>`
  ).join('');

  const ok = report.conclusion === 'success';
  const statusClass = ok ? 'aad-log-ok' : 'aad-log-err';
  const item = (label: string, value: string, wide = false) =>
    `<div class="aad-summary-item${wide ? ' aad-summary-item--wide' : ''}"><span class="aad-summary-label">${label}</span><span>${value}</span></div>`;

  el.$summary.innerHTML = `
    <div class="aad-summary-header">
      <span>📊 执行报告</span>
      <span class="aad-summary-actions">
        <button id="aad-copy-summary-btn" class="aad-btn aad-btn--sm" title="复制为 Markdown">📋 Copy MD</button>
      </span>
    </div>
    <div class="aad-summary-grid">
      ${item('结果', `<span class="${statusClass}">${ok ? '✅' : '❌'} ${esc(report.conclusion)}</span>`)}
      ${item('审批次数', `<span class="aad-log-ok">${report.approvals}</span>`)}
      ${item('监控时长', formatDuration(report.activeMs))}
      ${report.pausedMs > 0 ? item('暂停时长', formatDuration(report.pausedMs)) : ''}
      ${report.environments.length ? item('审批环境', esc(report.environments.join(', ')), true) : ''}
      ${item('开始', new Date(report.startedAt).toLocaleString())}
      ${item('结束', new Date(report.endedAt).toLocaleString())}
    </div>
    ${report.events.length > 0 ? `
      <div class="aad-summary-header aad-summary-timeline-header"><span>📋 执行时间线</span></div>
      <div class="aad-timeline">${timelineHtml}</div>
    ` : ''}
  `;
  el.$summary.classList.add('aad-visible');

  const copyBtn = el.$summary.querySelector<HTMLButtonElement>('#aad-copy-summary-btn');
  copyBtn?.addEventListener('click', async () => {
    const md = reportToMarkdown(report);
    try {
      await navigator.clipboard.writeText(md);
      copyBtn.textContent = '✓ Copied!';
      copyBtn.classList.add('aad-copied');
      setTimeout(() => {
        copyBtn.textContent = '📋 Copy MD';
        copyBtn.classList.remove('aad-copied');
      }, 1500);
    } catch {
      // Fallback: open in prompt
      window.prompt('复制以下 Markdown:', md);
    }
  });
}
