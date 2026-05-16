/**
 * Floating "active monitored runs" widget shown on non-run GitHub pages
 * (Actions list, repo home, etc.) when one or more runs are being actively monitored.
 *
 * Uses GM_listValues to scan `aad_running_${runId}` keys.
 */
import { esc, formatDuration } from '../utils/helpers';

const STALE_MS = 30 * 60 * 1000;
const WIDGET_ID = 'aad-overview';

interface ActiveRun {
  runId: string;
  startedAt: number;
  url?: string;
  approved?: number;
  owner?: string;
  repo?: string;
  workflow?: string;
}

function listActiveRuns(): ActiveRun[] {
  if (typeof GM_listValues !== 'function') return [];
  const now = Date.now();
  const out: ActiveRun[] = [];
  for (const key of GM_listValues()) {
    if (!key.startsWith('aad_running_')) continue;
    const ts = GM_getValue<number>(key, 0);
    if (!ts || (now - ts) > STALE_MS) continue;
    const runId = key.slice('aad_running_'.length);
    const session = GM_getValue<any>(`aad_session_${runId}`, null);
    const meta = GM_getValue<any>(`aad_meta_${runId}`, null);
    out.push({
      runId,
      startedAt: session?.startedAt || ts,
      approved: session?.approved || 0,
      url: meta?.url,
      owner: meta?.owner,
      repo: meta?.repo,
      workflow: meta?.workflow,
    });
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** Persist minimal metadata for a run so the overview widget can render links. */
export function saveRunMeta(runId: string, meta: { owner: string; repo: string; workflow: string }): void {
  GM_setValue(`aad_meta_${runId}`, {
    ...meta,
    url: `https://github.com/${meta.owner}/${meta.repo}/actions/runs/${runId}`,
  });
}

function renderWidget(runs: ActiveRun[]): void {
  let widget = document.getElementById(WIDGET_ID);
  if (runs.length === 0) {
    if (widget) widget.remove();
    return;
  }
  if (!widget) {
    widget = document.createElement('div');
    widget.id = WIDGET_ID;
    document.body.appendChild(widget);
  }
  const now = Date.now();
  const items = runs.map((r) => {
    const elapsed = formatDuration(now - r.startedAt);
    const label = r.workflow && r.owner && r.repo
      ? `${esc(r.owner)}/${esc(r.repo)} · ${esc(r.workflow)} #${esc(r.runId)}`
      : `Run #${esc(r.runId)}`;
    const href = r.url || `#`;
    return `<div class="aad-ov-item">
      <a href="${esc(href)}" class="aad-ov-link">${label}</a>
      <span class="aad-ov-meta">⏱ ${elapsed} · ✅ ${r.approved || 0}</span>
    </div>`;
  }).join('');
  widget.innerHTML = `
    <div class="aad-ov-header">
      <span>🚀 AAD · ${runs.length} active</span>
      <button class="aad-ov-close" title="Hide">×</button>
    </div>
    <div class="aad-ov-body">${items}</div>
  `;
  widget.querySelector('.aad-ov-close')?.addEventListener('click', () => widget!.remove());
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** Mount/refresh the overview widget. Safe to call repeatedly. */
export function mountOverviewWidget(isOnRunPage: boolean): void {
  if (isOnRunPage) {
    // The main panel is the source of truth on a run page; hide overview
    document.getElementById(WIDGET_ID)?.remove();
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    return;
  }
  const tick = () => renderWidget(listActiveRuns());
  tick();
  if (!refreshTimer) refreshTimer = setInterval(tick, 5000);
}

/** Remove meta for a run id (called when monitoring is fully stopped). */
export function clearRunMeta(runId: string): void {
  if (typeof GM_deleteValue === 'function') GM_deleteValue(`aad_meta_${runId}`);
}
