/**
 * Persistent config via GM_getValue / GM_setValue
 */
export interface Config {
  /** Fallback poll interval (seconds) while monitoring a run. */
  interval: number;
  /** Show the log-file hint in the run panel (logs are always persisted). */
  saveLog: boolean;
  panelVisible: boolean;
  /** Render the "My pull requests" section on the GitHub home sidebar. */
  showPullRequests: boolean;
  /** Render the "Organization repositories" section on the GitHub home sidebar. */
  showOrganizationRepos: boolean;
}

export const INTERVAL_MIN = 5;
export const INTERVAL_MAX = 300;
export const INTERVAL_DEFAULT = 15;

const STORAGE_KEYS: Record<keyof Config, string> = {
  interval: 'interval',
  saveLog: 'save_log',
  panelVisible: 'panel_visible',
  showPullRequests: 'show_pull_requests',
  showOrganizationRepos: 'show_organization_repos',
};

export function normalizeInterval(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return INTERVAL_DEFAULT;
  return Math.min(INTERVAL_MAX, Math.max(INTERVAL_MIN, n));
}

export function loadConfig(): Config {
  return {
    interval: normalizeInterval(GM_getValue(STORAGE_KEYS.interval, INTERVAL_DEFAULT)),
    saveLog: GM_getValue(STORAGE_KEYS.saveLog, false),
    panelVisible: GM_getValue(STORAGE_KEYS.panelVisible, true),
    showPullRequests: GM_getValue(STORAGE_KEYS.showPullRequests, true),
    showOrganizationRepos: GM_getValue(STORAGE_KEYS.showOrganizationRepos, true),
  };
}

export function saveConfigField<K extends keyof Config>(key: K, value: Config[K]): void {
  GM_setValue(STORAGE_KEYS[key], value);
}
