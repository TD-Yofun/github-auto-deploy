/**
 * Helper utilities
 */

export const ts = (): string =>
  new Date().toLocaleTimeString('en-US', { hour12: false });

/** Local `YYYY-MM-DD HH:MM:SS` (sv-SE formats this way natively). */
export const tsFull = (): string =>
  new Date().toLocaleString('sv-SE');

export function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

/** Render GitHub's `<em>match</em>` markers as `<mark>` while escaping everything else. */
export function renderMarked(text: string): string {
  return text.split(/<\/?em>/).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  const units: [number, string][] = [[86400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [size, label] of units) if (seconds >= size) return `${Math.floor(seconds / size)}${label} ago`;
  return 'just now';
}
