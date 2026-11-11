/** Inline stroke icons (currentColor). Deliberately not using GitHub's `.octicon` class, which forces `fill`. */
const icon = (paths: string): string =>
  `<svg class="aad-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

export const ICON_SETTINGS = icon('<path d="M2 4h5.25M10.75 4H14M2 12h2.25M7.75 12H14"/><circle cx="9" cy="4" r="1.75"/><circle cx="6" cy="12" r="1.75"/>');
export const ICON_DOWNLOAD = icon('<path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13h11"/>');
export const ICON_CHEVRON_RIGHT = icon('<path d="m6 3.5 4.5 4.5L6 12.5"/>');
export const ICON_CLOSE = icon('<path d="m3.5 3.5 9 9m0-9-9 9"/>');
