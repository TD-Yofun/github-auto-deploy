/**
 * Settings — a header entry on every GitHub page that opens a configuration dialog.
 * Changes are applied immediately (no Save button), matching GitHub's own toggles.
 */
import { INTERVAL_MAX, INTERVAL_MIN, normalizeInterval, saveConfigField, type Config } from '../core/config';
import { getCurrentVersion, type VersionCheckResult } from '../core/version-check';
import { renderUpdateNotice } from './update-notice';
import { esc } from '../utils/helpers';
import { ICON_CLOSE, ICON_SETTINGS } from './icons';

const ENTRY_ID = 'aad-settings-entry';
const OVERLAY_ID = 'aad-settings-overlay';
const REPO_URL = 'https://github.com/TD-Yofun/github-auto-deploy';

let config: Config;
let onChange: (key: keyof Config) => void = () => {};
let observer: MutationObserver | null = null;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let lastFocus: HTMLElement | null = null;
/** Set when the installed script is outdated: the dialog then only offers the update. */
let updateRequired: VersionCheckResult | null = null;

// ── Header entry ───────────────────────────────────────────
interface InsertionPoint {
  parent: HTMLElement;
  before: Element | null;
  /** Native icon button to borrow its classes from, so the entry matches GitHub's look. */
  template: HTMLElement | null;
}

/**
 * Current dashboard header (React, hashed class names): anchor on the stable bits —
 * the avatar image and the "Pull requests" icon link — and insert just before the avatar.
 */
function findReactHeaderPoint(): InsertionPoint | null {
  const header = document.querySelector<HTMLElement>('header.GlobalNav, header[class*="appHeader"]');
  const pulls = header?.querySelector<HTMLElement>('a[href="/pulls"]');
  const avatar = header?.querySelector<HTMLElement>('img[alt="User avatar"], img.avatar');
  if (!header || !pulls || !avatar) return null;

  // The avatar's ancestor that sits in the same row as the other header icons.
  let item: HTMLElement = avatar;
  while (item.parentElement && item.parentElement !== header && !item.parentElement.contains(pulls)) {
    item = item.parentElement;
  }
  if (!item.parentElement || item.parentElement === header) return null;
  return { parent: item.parentElement, before: item, template: pulls };
}

/** Legacy `AppHeader` layout (kept as a fallback for older GitHub UIs). */
function findLegacyHeaderPoint(): InsertionPoint | null {
  const parent =
    document.querySelector<HTMLElement>('.AppHeader-actions') ||
    document.querySelector<HTMLElement>('.AppHeader-globalBar-end');
  if (!parent) return null;
  return { parent, before: parent.querySelector(':scope > .AppHeader-user'), template: null };
}

function ensureEntry(): void {
  reconcileTimer = null;
  if (document.getElementById(ENTRY_ID)) return;
  const point = findReactHeaderPoint() || findLegacyHeaderPoint();
  if (!point) return;

  const button = document.createElement('button');
  button.id = ENTRY_ID;
  button.type = 'button';
  if (point.template) {
    // Copy Primer React's hashed classes and data-* variant/size attributes from a native icon button.
    button.className = point.template.className;
    for (const name of ['data-component', 'data-size', 'data-variant', 'data-no-visuals']) {
      const value = point.template.getAttribute(name);
      if (value !== null) button.setAttribute(name, value);
    }
  } else {
    button.className = 'Button Button--iconOnly Button--secondary Button--medium AppHeader-button';
  }
  button.title = updateRequired ? 'Auto-Approve Deploy: update required' : 'Auto-Approve Deploy settings';
  button.classList.toggle('aad-needs-update', !!updateRequired);
  button.setAttribute('aria-label', 'Auto-Approve Deploy settings');
  button.setAttribute('aria-haspopup', 'dialog');
  button.innerHTML = ICON_SETTINGS;
  button.addEventListener('click', openSettings);
  point.parent.insertBefore(button, point.before);
}

/** GitHub re-renders the header on Turbo navigations; keep the entry mounted. */
function watchHeader(): void {
  if (observer) return;
  observer = new MutationObserver(() => {
    if (document.getElementById(ENTRY_ID) || reconcileTimer) return;
    reconcileTimer = setTimeout(ensureEntry, 100);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function initSettings(initial: Config, handler: (key: keyof Config) => void): void {
  config = initial;
  onChange = handler;
  ensureEntry();
  watchHeader();
}

// ── Dialog ─────────────────────────────────────────────────
function checkboxRow(id: string, label: string, description: string, checked: boolean): string {
  return `<div class="aad-st-row">
    <div class="aad-st-label"><label for="${id}">${label}</label><p>${description}</p></div>
    <div class="aad-st-control"><input id="${id}" type="checkbox" ${checked ? 'checked' : ''}></div>
  </div>`;
}

function buildUpdateDialog(v: VersionCheckResult): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div id="aad-settings" role="dialog" aria-modal="true" aria-labelledby="aad-settings-title">
      <div class="aad-st-header">
        <h2 id="aad-settings-title">Update required</h2>
        <button type="button" class="aad-icon-btn" data-close title="Close" aria-label="Close">${ICON_CLOSE}</button>
      </div>
      <div class="aad-st-body"><section class="aad-st-section">${renderUpdateNotice(v)}</section></div>
      <div class="aad-st-footer"><span>All features are disabled until you update.</span></div>
    </div>`;
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeSettings();
  });
  overlay.querySelector('[data-close]')!.addEventListener('click', closeSettings);
  return overlay;
}

function buildDialog(): HTMLDivElement {
  if (updateRequired) return buildUpdateDialog(updateRequired);
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div id="aad-settings" role="dialog" aria-modal="true" aria-labelledby="aad-settings-title">
      <div class="aad-st-header">
        <h2 id="aad-settings-title">Auto-Approve Deploy settings</h2>
        <button type="button" class="aad-icon-btn" data-close title="Close" aria-label="Close">${ICON_CLOSE}</button>
      </div>
      <div class="aad-st-body">
        <section class="aad-st-section">
          <h3>Monitoring</h3>
          <div class="aad-st-row">
            <div class="aad-st-label">
              <label for="aad-st-interval">Polling interval</label>
              <p>Fallback check frequency while monitoring a Deploy (PRD) run (${INTERVAL_MIN}–${INTERVAL_MAX} seconds).</p>
            </div>
            <div class="aad-st-control">
              <input id="aad-st-interval" type="number" min="${INTERVAL_MIN}" max="${INTERVAL_MAX}" value="${config.interval}"><span>s</span>
            </div>
          </div>
          ${checkboxRow('aad-st-savelog', 'Show log file path', 'Display the log file name in the run panel. Logs are always kept and downloadable.', config.saveLog)}
        </section>
        <section class="aad-st-section">
          <h3>GitHub home</h3>
          ${checkboxRow('aad-st-prs', 'My pull requests', 'Show the pull request summary in the dashboard sidebar.', config.showPullRequests)}
          ${checkboxRow('aad-st-orgs', 'Organization repositories', 'Show the organization repository search in the dashboard sidebar.', config.showOrganizationRepos)}
        </section>
      </div>
      <div class="aad-st-footer">
        <span>Version ${esc(getCurrentVersion())}</span>
        <a href="${REPO_URL}" target="_blank" rel="noopener">Project on GitHub</a>
      </div>
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => overlay.querySelector<T>(`#${id}`)!;

  const interval = $<HTMLInputElement>('aad-st-interval');
  interval.addEventListener('change', () => {
    config.interval = normalizeInterval(interval.value);
    interval.value = String(config.interval);
    saveConfigField('interval', config.interval);
    onChange('interval');
  });

  const bind = (id: string, key: 'saveLog' | 'showPullRequests' | 'showOrganizationRepos') => {
    const input = $<HTMLInputElement>(id);
    input.addEventListener('change', () => {
      config[key] = input.checked;
      saveConfigField(key, input.checked);
      onChange(key);
    });
  };
  bind('aad-st-savelog', 'saveLog');
  bind('aad-st-prs', 'showPullRequests');
  bind('aad-st-orgs', 'showOrganizationRepos');

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeSettings();
  });
  overlay.querySelector('[data-close]')!.addEventListener('click', closeSettings);
  return overlay;
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closeSettings();
  }
}

/** Mark the script as outdated (or clear it). Settings are unavailable while set. */
export function setUpdateRequired(info: VersionCheckResult | null): void {
  updateRequired = info;
  const entry = document.getElementById(ENTRY_ID);
  entry?.classList.toggle('aad-needs-update', !!info);
  if (entry) entry.title = info ? 'Auto-Approve Deploy: update required' : 'Auto-Approve Deploy settings';
  if (document.getElementById(OVERLAY_ID)) { closeSettings(); openSettings(); }
}

export function openSettings(): void {
  if (document.getElementById(OVERLAY_ID)) return;
  lastFocus = document.activeElement as HTMLElement | null;
  document.body.appendChild(buildDialog());
  document.addEventListener('keydown', onKeydown, true);
  document.querySelector<HTMLElement>('#aad-st-interval')?.focus();
}

export function closeSettings(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  document.removeEventListener('keydown', onKeydown, true);
  lastFocus?.focus?.();
  lastFocus = null;
}
