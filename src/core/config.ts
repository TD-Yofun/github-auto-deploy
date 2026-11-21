/**
 * Persistent config via GM_getValue / GM_setValue
 */
export interface Config {
  /** Fallback poll interval (seconds) while monitoring a run. */
  interval: number;
  /** Show the log-file hint in the run panel (logs are always persisted). */
  saveLog: boolean;
  panelVisible: boolean;
  /** Replace the GitHub home page with the work dashboard (favorites, PRs, repository search). */
  homeDashboard: boolean;
  /** Comma-separated organization logins for repository search; empty = detect automatically. */
  organizations: string;
}

export const INTERVAL_MIN = 5;
export const INTERVAL_MAX = 300;
export const INTERVAL_DEFAULT = 15;

const STORAGE_KEYS: Record<keyof Config, string> = {
  interval: 'interval',
  saveLog: 'save_log',
  panelVisible: 'panel_visible',
  homeDashboard: 'home_dashboard',
  organizations: 'organizations',
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
    homeDashboard: GM_getValue(STORAGE_KEYS.homeDashboard, true),
    organizations: String(GM_getValue(STORAGE_KEYS.organizations, '')),
  };
}

export function saveConfigField<K extends keyof Config>(key: K, value: Config[K]): void {
  GM_setValue(STORAGE_KEYS[key], value);
}
