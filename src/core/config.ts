/**
 * Persistent config via GM_getValue / GM_setValue
 */
export interface Config {
  interval: number;
  saveLog: boolean;
  panelVisible: boolean;
}

export function loadConfig(): Config {
  return {
    interval: GM_getValue('interval', 15),
    saveLog: GM_getValue('save_log', false),
    panelVisible: GM_getValue('panel_visible', true),
  };
}

export function saveConfigField<K extends keyof Config>(key: K, value: Config[K]): void {
  const keyMap: Record<keyof Config, string> = {
    interval: 'interval',
    saveLog: 'save_log',
    panelVisible: 'panel_visible',
  };
  GM_setValue(keyMap[key], value);
}
