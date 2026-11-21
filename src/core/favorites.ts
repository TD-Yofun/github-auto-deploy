/** Favorite repositories, stored per user in Tampermonkey storage. */
const KEY = 'favorite_repos';
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

type Listener = (favorites: string[]) => void;
const listeners = new Set<Listener>();

/** Accepts `owner/repo` or a github.com repository URL; returns the normalized name or null. */
export function parseRepository(input: string): string | null {
  const value = input.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const [owner, repo] = value.split('/');
  const name = owner && repo ? `${owner}/${repo}` : value;
  return REPO_RE.test(name) ? name : null;
}

export function getFavorites(): string[] {
  const raw = GM_getValue<unknown>(KEY, []);
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

function save(favorites: string[]): void {
  GM_setValue(KEY, favorites);
  listeners.forEach((listener) => listener(favorites));
}

export const isFavorite = (fullName: string): boolean =>
  getFavorites().some((f) => f.toLowerCase() === fullName.toLowerCase());

export function addFavorite(fullName: string): boolean {
  const name = parseRepository(fullName);
  if (!name || isFavorite(name)) return false;
  save([...getFavorites(), name]);
  return true;
}

export function removeFavorite(fullName: string): void {
  save(getFavorites().filter((f) => f.toLowerCase() !== fullName.toLowerCase()));
}

/**
 * Move a favorite so it is inserted at `position` of the current list (0 … length, i.e. a gap
 * between rows, as drag-and-drop yields). The order is the stored order, so it persists.
 */
export function moveFavorite(fullName: string, position: number): void {
  const list = getFavorites();
  const from = list.findIndex((f) => f.toLowerCase() === fullName.toLowerCase());
  if (from < 0) return;
  const to = Math.max(0, Math.min(list.length, position)) - (position > from ? 1 : 0);
  if (to === from) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  save(list);
}

export function subscribeFavorites(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
