/** Inline stroke icons (currentColor). Deliberately not using GitHub's `.octicon` class, which forces `fill`. */
const icon = (paths: string): string =>
  `<svg class="aad-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

export const ICON_SETTINGS = icon('<path d="M2 4h5.25M10.75 4H14M2 12h2.25M7.75 12H14"/><circle cx="9" cy="4" r="1.75"/><circle cx="6" cy="12" r="1.75"/>');
export const ICON_DOWNLOAD = icon('<path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13h11"/>');
export const ICON_CHEVRON_RIGHT = icon('<path d="m6 3.5 4.5 4.5L6 12.5"/>');
/** Six-dot drag handle (filled, unlike the stroke icons). */
export const ICON_GRIP = '<svg class="aad-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="6" cy="4" r="1.2"/><circle cx="10" cy="4" r="1.2"/><circle cx="6" cy="8" r="1.2"/><circle cx="10" cy="8" r="1.2"/><circle cx="6" cy="12" r="1.2"/><circle cx="10" cy="12" r="1.2"/></svg>';
// General-purpose 16px icons (stroke unless noted).
export const ICON_STAR = icon('<path d="m8 1.9 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2.1.7-4.3-3.1-3 4.3-.6z"/>');
export const ICON_PULL = icon('<circle cx="4" cy="3.5" r="1.5"/><circle cx="4" cy="12.5" r="1.5"/><circle cx="12" cy="12.5" r="1.5"/><path d="M4 5v6M12 11V6.5a2 2 0 0 0-2-2H8"/><path d="m9.8 2.6-1.9 1.9 1.9 1.9"/>');
export const ICON_EYE = icon('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>');
export const ICON_SEARCH = icon('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/>');
export const ICON_REPO = icon('<path d="M3 3.5A1.5 1.5 0 0 1 4.5 2H13v9.5H4.5A1.5 1.5 0 0 0 3 13z"/><path d="M3 13a1.5 1.5 0 0 0 1.5 1.5H13v-3"/>');
export const ICON_CLOCK = icon('<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.3 1.5"/>');
export const ICON_HOME = icon('<path d="m2 7.5 6-5 6 5"/><path d="M3.5 6.5v7h9v-7"/>');
export const ICON_INFO = icon('<circle cx="8" cy="8" r="6"/><path d="M8 7.2V11M8 5v.1"/>');
export const ICON_ACTIVITY = icon('<path d="M1.5 8h3l2-5 3 10 2-5h3"/>');
export const ICON_WARNING = icon('<path d="M8 2.5 1.8 13.2h12.4z"/><path d="M8 6.8V10M8 11.8v.1"/>');
export const ICON_DRAFT = icon('<circle cx="8" cy="8" r="5.5" stroke-dasharray="2.6 2.2"/>');
export const ICON_LOCK = icon('<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7"/>');
export const ICON_ROCKET = icon('<path d="M9.5 2.5c2.2.3 3.7 1.8 4 4-1.1 2.7-3 4.6-5.5 5.6L4.2 8c1-2.6 2.9-4.5 5.3-5.5z"/><path d="M4.2 8 2 8.8M8 11.8 7.2 14M10.2 5.8h.1"/>');
export const ICON_LOG = icon('<path d="M4 2h5.5l3 3v9H4z"/><path d="M9.5 2v3h3M6 8h4.5M6 10.5h4.5"/>');
// Filled transport icons for the run panel.
const filled = (shapes: string): string =>
  `<svg class="aad-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">${shapes}</svg>`;
export const ICON_PLAY = filled('<path d="M5 3.2v9.6L12.5 8z"/>');
export const ICON_PAUSE = filled('<rect x="4.5" y="3.5" width="2.5" height="9" rx=".6"/><rect x="9" y="3.5" width="2.5" height="9" rx=".6"/>');
export const ICON_STOP = filled('<rect x="4" y="4" width="8" height="8" rx="1.2"/>');
export const ICON_CLOSE = icon('<path d="m3.5 3.5 9 9m0-9-9 9"/>');

/** Larger 24px icons for empty states. */
const icon24 = (paths: string, size = 32): string =>
  `<svg class="aad-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

export const EMPTY_ICONS = {
  check: icon24('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8 5.4-5.8"/>'),
  inbox: icon24('<path d="M3.5 13.5 6 5.5h12l2.5 8v5h-17z"/><path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/>'),
  star: icon24('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  search: icon24('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  alert: icon24('<path d="M12 4 3 19.5h18z"/><path d="M12 10v4.5M12 17.2v.1"/>'),
  lock: icon24('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
} as const;

/** Small status glyphs for the CI details list. */
export const CHECK_ICONS = {
  success: icon('<path d="m3.5 8.5 3 3 6-6.5"/>'),
  failure: icon('<path d="m4 4 8 8m0-8-8 8"/>'),
  attention: icon('<path d="M8 3.5v5.5M8 11.8v.1"/>'),
  running: '<svg class="aad-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="3.2" fill="currentColor"/></svg>',
  skipped: icon('<path d="M4 8h8"/>'),
};
