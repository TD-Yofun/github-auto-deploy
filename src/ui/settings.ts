/**
 * Settings — a header entry on every GitHub page that opens a configuration dialog.
 * Changes are applied immediately (no Save button), matching GitHub's own toggles.
 */
import { INTERVAL_MAX, INTERVAL_MIN, normalizeInterval, saveConfigField, type Config } from '../core/config';
import { parseOrganizations } from '../core/organizations';
import { checkLatestVersion, getCurrentVersion, type VersionCheckResult } from '../core/version-check';
import { renderUpdateNotice } from './update-notice';
import { esc } from '../utils/helpers';
import { CHECK_ICONS, ICON_ACTIVITY, ICON_CLOSE, ICON_HOME, ICON_INFO, ICON_SETTINGS } from './icons';
import { lockScroll, unlockScroll } from './scroll-lock';

const ENTRY_ID = 'aad-settings-entry';
const OVERLAY_ID = 'aad-settings-overlay';
const REPO_URL = 'https://github.com/TD-Yofun/github-auto-deploy';

type TabId = 'monitoring' | 'dashboard' | 'about';

let config: Config;
let onChange: (key: keyof Config) => void = () => {};
/** Called when a manual check finds a newer release: the host locks the script. */
let onOutdated: (info: VersionCheckResult) => void = () => {};
let observer: MutationObserver | null = null;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let lastFocus: HTMLElement | null = null;
/** The section last opened; the dialog reopens on it. */
let activeTab: TabId = 'monitoring';
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

export function initSettings(initial: Config, handler: (key: keyof Config) => void, outdatedHandler?: (info: VersionCheckResult) => void): void {
  config = initial;
  onChange = handler;
  if (outdatedHandler) onOutdated = outdatedHandler;
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
  overlay.className = 'aad-modal-overlay';
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

interface Tab {
  id: TabId;
  label: string;
  icon: string;
  description: string;
  body: () => string;
}

/** The left menu. Each entry owns one pane on the right. */
const TABS: Tab[] = [
  {
    id: 'monitoring',
    label: 'Monitoring',
    icon: ICON_ACTIVITY,
    description: 'How the script watches Deploy (PRD) workflow runs.',
    body: () => `
      <div class="aad-st-row">
        <div class="aad-st-label">
          <label for="aad-st-interval">Polling interval</label>
          <p>Fallback check frequency while monitoring a run (${INTERVAL_MIN}–${INTERVAL_MAX} seconds). It takes effect on the next check, even while monitoring.</p>
        </div>
        <div class="aad-st-control">
          <input id="aad-st-interval" type="number" min="${INTERVAL_MIN}" max="${INTERVAL_MAX}" value="${config.interval}"><span>s</span>
        </div>
      </div>
      ${checkboxRow('aad-st-savelog', 'Show log file path', 'Display the log file name in the run panel. Logs are always kept and downloadable.', config.saveLog)}`,
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: ICON_HOME,
    description: 'The work dashboard that can replace the GitHub home page.',
    body: () => `
      ${checkboxRow('aad-st-home', 'Work dashboard', 'Replace the GitHub home page with favorites, my pull requests, review requests and repository search. Turn off to restore the original page.', config.homeDashboard)}
      <div class="aad-st-row">
        <div class="aad-st-label">
          <label for="aad-st-orgs">Organizations</label>
          <p>Organization logins to search, comma separated (e.g. <code>Talkdesk</code>). Leave empty to detect automatically.</p>
        </div>
        <div class="aad-st-control">
          <input id="aad-st-orgs" class="aad-st-text" type="text" value="${esc(config.organizations)}" placeholder="auto" spellcheck="false" autocomplete="off">
        </div>
      </div>`,
  },
  {
    id: 'about',
    label: 'About',
    icon: ICON_INFO,
    description: 'Auto-Approve Deploy Gates — approves GitHub Actions deployment gates and adds a work dashboard.',
    body: () => `
      <div class="aad-st-row"><div class="aad-st-label"><label>Version</label><p>${esc(getCurrentVersion())}</p></div></div>
      <div class="aad-st-row">
        <div class="aad-st-label">
          <label>Updates</label>
          <p class="aad-st-status" data-update-status aria-live="polite">Checked automatically whenever you open GitHub (cached for 15 minutes). The script stops working until it is updated.</p>
        </div>
        <div class="aad-st-control"><button type="button" class="aad-btn aad-btn--sm" data-check-update>Check for updates</button></div>
      </div>
      <div class="aad-st-row">
        <div class="aad-st-label"><label>Links</label>
          <p class="aad-st-links"><a href="${REPO_URL}" target="_blank" rel="noopener">Project on GitHub</a>
            <a href="${REPO_URL}/releases" target="_blank" rel="noopener">Releases</a>
            <a href="${REPO_URL}/issues" target="_blank" rel="noopener">Report an issue</a></p>
        </div>
      </div>`,
  },
];

function buildDialog(): HTMLDivElement {
  if (updateRequired) return buildUpdateDialog(updateRequired);
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'aad-modal-overlay';
  overlay.innerHTML = `
    <div id="aad-settings" class="aad-st--tabs" role="dialog" aria-modal="true" aria-labelledby="aad-settings-title">
      <div class="aad-st-header">
        <h2 id="aad-settings-title"><span class="aad-title-icon">${ICON_SETTINGS}</span>Settings</h2>
        <button type="button" class="aad-icon-btn" data-close title="Close" aria-label="Close">${ICON_CLOSE}</button>
      </div>
      <div class="aad-st-layout">
        <nav class="aad-st-nav" role="tablist" aria-orientation="vertical" aria-label="Settings sections">
          ${TABS.map((t) => `<button type="button" role="tab" class="aad-st-tab" id="aad-st-tab-${t.id}" data-tab="${t.id}" aria-controls="aad-st-pane-${t.id}">${t.icon}<span>${t.label}</span></button>`).join('')}
          <span class="aad-st-version">v${esc(getCurrentVersion())}</span>
        </nav>
        <div class="aad-st-content">
          ${TABS.map((t) => `<section class="aad-st-pane" role="tabpanel" id="aad-st-pane-${t.id}" aria-labelledby="aad-st-tab-${t.id}" hidden>
            <h3 class="aad-st-pane-title"><span class="aad-title-icon">${t.icon}</span>${t.label}</h3>
            <p class="aad-st-pane-desc">${t.description}</p>
            ${t.body()}
          </section>`).join('')}
        </div>
      </div>
    </div>`;

  const $ = <T extends HTMLElement>(id: string) => overlay.querySelector<T>(`#${id}`)!;

  // ── tabs: click or arrow keys, roving tabindex ──
  const tabs = [...overlay.querySelectorAll<HTMLButtonElement>('.aad-st-tab')];
  const select = (id: TabId, focus = false): void => {
    activeTab = id;
    for (const tab of tabs) {
      const on = tab.dataset.tab === id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      tab.classList.toggle('is-active', on);
      overlay.querySelector<HTMLElement>(`#aad-st-pane-${tab.dataset.tab}`)!.hidden = !on;
      if (on && focus) tab.focus();
    }
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => select(tab.dataset.tab as TabId)));
  overlay.querySelector('.aad-st-nav')!.addEventListener('keydown', (event) => {
    const e = event as KeyboardEvent;
    const index = tabs.findIndex((t) => t.dataset.tab === activeTab);
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    const target = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : -1;
    if (target < 0) return;
    e.preventDefault();
    select(tabs[target].dataset.tab as TabId, true);
  });
  select(activeTab);

  // ── settings ──
  const interval = $<HTMLInputElement>('aad-st-interval');
  interval.addEventListener('change', () => {
    config.interval = normalizeInterval(interval.value);
    interval.value = String(config.interval);
    saveConfigField('interval', config.interval);
    onChange('interval');
  });

  const organizations = $<HTMLInputElement>('aad-st-orgs');
  organizations.addEventListener('change', () => {
    config.organizations = parseOrganizations(organizations.value).join(', ');
    organizations.value = config.organizations;
    saveConfigField('organizations', config.organizations);
    onChange('organizations');
  });

  const bind = (id: string, key: 'saveLog' | 'homeDashboard') => {
    const input = $<HTMLInputElement>(id);
    input.addEventListener('change', () => {
      config[key] = input.checked;
      saveConfigField(key, input.checked);
      onChange(key);
    });
  };
  bind('aad-st-savelog', 'saveLog');
  bind('aad-st-home', 'homeDashboard');

  // ── manual update check: bypasses the cache; a newer release locks the script right away ──
  const checkButton = overlay.querySelector<HTMLButtonElement>('[data-check-update]')!;
  const status = overlay.querySelector<HTMLElement>('[data-update-status]')!;
  checkButton.addEventListener('click', async () => {
    checkButton.disabled = true;
    checkButton.textContent = 'Checking…';
    status.className = 'aad-st-status';
    status.textContent = 'Contacting GitHub…';
    try {
      const result = await checkLatestVersion(getCurrentVersion(), true);
      if (result.outdated) {
        onOutdated(result); // swaps this dialog for the "Update required" notice
        return;
      }
      status.classList.add('is-ok');
      status.innerHTML = `${CHECK_ICONS.success}You're on the latest version (v${esc(result.current)}). Checked just now.`;
    } catch (error) {
      status.classList.add('is-error');
      status.textContent = `Couldn't check for updates: ${(error as Error).message}. Try again.`;
    } finally {
      checkButton.disabled = false;
      checkButton.textContent = 'Check for updates';
    }
  });

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
  lockScroll();
  document.addEventListener('keydown', onKeydown, true);
  (document.querySelector<HTMLElement>('#aad-settings .aad-st-tab.is-active') ?? document.querySelector<HTMLElement>('#aad-settings [data-close]'))?.focus();
}

export function closeSettings(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  overlay?.remove();
  document.removeEventListener('keydown', onKeydown, true);
  if (overlay) unlockScroll();
  lastFocus?.focus?.();
  lastFocus = null;
}
