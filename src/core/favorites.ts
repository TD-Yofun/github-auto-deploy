/**
 * Favorite repositories and their tags, stored per user in Tampermonkey storage.
 * The ordered list of names lives in `favorite_repos`; tags are a separate map so the list (and
 * its order) is untouched by tagging.
 */
const KEY = 'favorite_repos';
const TAGS_KEY = 'favorite_tags';
export const MAX_TAG_LENGTH = 24;
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
  const tags = readTags();
  if (delete tags[tagKey(fullName)]) GM_setValue(TAGS_KEY, tags);
  save(getFavorites().filter((f) => f.toLowerCase() !== fullName.toLowerCase()));
}

// ── Tags ───────────────────────────────────────────────────

/** `owner/repo` → lower-cased key; repository names are case-insensitive on GitHub. */
const tagKey = (fullName: string): string => fullName.toLowerCase();
const sameTag = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Trim, drop a leading `#`, collapse spaces, cap the length; null when nothing is left. */
export function normalizeTag(input: string): string | null {
  const tag = input.trim().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH).trim();
  return tag || null;
}

function readTags(): Record<string, string[]> {
  const raw = GM_getValue<unknown>(TAGS_KEY, {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [],
    ]),
  );
}

function saveTags(tags: Record<string, string[]>): void {
  GM_setValue(TAGS_KEY, tags);
  listeners.forEach((listener) => listener(getFavorites()));
}

export const getTags = (fullName: string): string[] => readTags()[tagKey(fullName)] ?? [];

export const hasTag = (fullName: string, tag: string): boolean => getTags(fullName).some((t) => sameTag(t, tag));

/** Returns false when the tag is empty or the repository already has it. */
export function addTag(fullName: string, input: string): boolean {
  const tag = normalizeTag(input);
  if (!tag || !isFavorite(fullName) || hasTag(fullName, tag)) return false;
  const tags = readTags();
  const key = tagKey(fullName);
  // Reuse an existing spelling ("Backend" vs "backend") so the tabs never show two of the same tag.
  const spelling = listTags().find((t) => sameTag(t.tag, tag))?.tag ?? tag;
  tags[key] = [...(tags[key] ?? []), spelling];
  saveTags(tags);
  return true;
}

export function removeTag(fullName: string, tag: string): void {
  const tags = readTags();
  const key = tagKey(fullName);
  const rest = (tags[key] ?? []).filter((t) => !sameTag(t, tag));
  if (rest.length > 0) tags[key] = rest; else delete tags[key];
  saveTags(tags);
}

export interface TagSummary {
  tag: string;
  /** Favorites carrying the tag. */
  count: number;
}

/** Every tag in use by a current favorite, alphabetical (case-insensitive), with its count. */
export function listTags(): TagSummary[] {
  const tags = readTags();
  const counts = new Map<string, TagSummary>();
  for (const name of getFavorites()) {
    for (const tag of tags[tagKey(name)] ?? []) {
      const entry = counts.get(tag.toLowerCase());
      if (entry) entry.count++;
      else counts.set(tag.toLowerCase(), { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }));
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
