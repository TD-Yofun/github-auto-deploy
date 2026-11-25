/** Repository search over the organizations and your own account: results appear in a floating panel while the input has focus. */
import { addFavorite, isFavorite, removeFavorite, subscribeFavorites } from '../../core/favorites';
import { LoginRequiredError } from '../../core/github';
import { getCurrentLogin, getOrganizations } from '../../core/organizations';
import { searchRepositories, type RepositoryHit, type RepositorySearchResult } from '../../core/repo-search';
import { getSsoOrganizations } from '../../core/sso';
import { esc, renderMarked } from '../../utils/helpers';
import { ICON_REPO, ICON_SEARCH } from '../icons';
import { renderEmptyState } from './empty-state';
import { renderSsoNotice } from './sso-notice';

const DEBOUNCE_MS = 250;
const MAX_RESULTS = 10;

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; query: string; result: RepositorySearchResult };

export interface SearchBox {
  el: HTMLElement;
  /** Re-detect organizations (after the setting changed) and refresh the placeholder. */
  reset(): void;
}

export function createSearchBox(getOrganizationSetting: () => string): SearchBox {
  const el = document.createElement('div');
  el.className = 'aad-search';
  el.innerHTML = `<span class="aad-search-icon" aria-hidden="true">${ICON_SEARCH}</span><input class="aad-input aad-search-input" type="search" role="combobox" aria-expanded="false" aria-controls="aad-search-results" aria-label="Search organization and personal repositories" placeholder="Search repositories…" autocomplete="off" spellcheck="false">
    <div class="aad-popover" id="aad-search-results" role="listbox" hidden></div>`;
  const input = el.querySelector<HTMLInputElement>('input')!;
  const popover = el.querySelector<HTMLElement>('.aad-popover')!;

  let state: State = { kind: 'idle' };
  let open = false;
  let active = 0;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let organizations: string[] = [];

  /** Human-readable scope: the organizations plus "your repositories". */
  const scope = (): string => {
    const parts = [...organizations, ...(getCurrentLogin() ? ['your repositories'] : [])];
    if (parts.length === 0) return 'your organization';
    return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  };

  const hits = (): RepositoryHit[] => (state.kind === 'ready' ? state.result.hits.slice(0, MAX_RESULTS) : []);

  function popoverBody(): string {
    switch (state.kind) {
      case 'loading': return '<div class="aad-empty">Searching…</div>';
      case 'error': return renderEmptyState({ icon: 'alert', title: "Couldn't search", message: state.message, danger: true });
      case 'ready': {
        const { query, result } = state;
        const blocked = getSsoOrganizations().filter((o) => result.ssoBlocked.some((l) => l.toLowerCase() === o.login.toLowerCase()));
        if (result.hits.length === 0) {
          return renderEmptyState({ icon: 'search', title: 'No repositories found', message: `Nothing in ${scope()} matches “${query}”.` }) + renderSsoNotice(blocked, true);
        }
        return hits().map((hit, index) => {
          const starred = isFavorite(hit.fullName);
          return `<div class="aad-hit${index === active ? ' is-active' : ''}" role="option" aria-selected="${index === active}" data-index="${index}">
            <span class="aad-row-icon aad-hit-icon" aria-hidden="true">${ICON_REPO}</span>
            <a class="aad-hit-main" href="${esc(hit.url)}" target="_blank" rel="noopener">
              <span class="aad-hit-name">${renderMarked(hit.nameMarked)}${hit.archived ? ' <span class="aad-chip aad-chip--muted">Archived</span>' : ''}${hit.isPublic ? '' : ' <span class="aad-chip aad-chip--muted">Private</span>'}</span>
              ${hit.descriptionMarked ? `<span class="aad-hit-desc">${renderMarked(hit.descriptionMarked)}</span>` : ''}
              ${hit.language ? `<span class="aad-hit-lang">${esc(hit.language)}</span>` : ''}
            </a>
            <button type="button" class="aad-icon-btn aad-star${starred ? ' is-on' : ''}" data-star="${esc(hit.fullName)}" aria-pressed="${starred}" title="${starred ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${starred ? 'Remove' : 'Add'} ${esc(hit.fullName)} ${starred ? 'from' : 'to'} favorites">${starred ? '★' : '☆'}</button>
          </div>`;
        }).join('') + renderSsoNotice(blocked, true);
      }
      default: {
        return renderEmptyState({ icon: 'search', title: 'Search repositories', message: `Type a name to search in ${scope()}.` }) + renderSsoNotice(getSsoOrganizations(), true);
      }
    }
  }

  function render(): void {
    popover.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (open) popover.innerHTML = popoverBody();
  }

  async function run(query: string): Promise<void> {
    const run = ++generation;
    state = { kind: 'loading' };
    active = 0;
    render();
    try {
      organizations = await getOrganizations(getOrganizationSetting());
      const user = getCurrentLogin();
      if (organizations.length === 0 && !user) throw new Error('No organization found. Set one in the settings.');
      const result = await searchRepositories(organizations, query, user);
      if (run === generation) state = { kind: 'ready', query, result };
    } catch (error) {
      if (run !== generation) return;
      state = { kind: 'error', message: error instanceof LoginRequiredError ? 'Sign in to GitHub to search' : (error as Error).message };
    }
    render();
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    const query = input.value.trim();
    if (!query) {
      generation++;
      state = { kind: 'idle' };
      render();
      return;
    }
    timer = setTimeout(() => void run(query), DEBOUNCE_MS);
  }

  function setOpen(value: boolean): void {
    open = value;
    render();
  }

  input.addEventListener('focus', () => setOpen(true));
  input.addEventListener('input', () => { setOpen(true); schedule(); });
  input.addEventListener('keydown', (event) => {
    const list = hits();
    if (event.key === 'Escape') { setOpen(false); input.blur(); return; }
    if (!open) { if (event.key === 'ArrowDown') setOpen(true); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.length === 0) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      render();
      popover.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && list[active]) {
      event.preventDefault();
      window.open(list[active].url, '_blank', 'noopener');
    }
  });
  popover.addEventListener('mousedown', (event) => event.preventDefault()); // keep input focus
  popover.addEventListener('click', (event) => {
    const star = (event.target as HTMLElement).closest<HTMLElement>('[data-star]');
    if (!star) return;
    const name = star.dataset.star!;
    if (isFavorite(name)) removeFavorite(name); else addFavorite(name);
  });
  document.addEventListener('mousedown', (event) => {
    if (open && !el.contains(event.target as Node)) setOpen(false);
  });
  subscribeFavorites(() => { if (open && state.kind === 'ready') render(); });

  async function updatePlaceholder(): Promise<void> {
    try {
      organizations = await getOrganizations(getOrganizationSetting());
      if (organizations.length || getCurrentLogin()) input.placeholder = `Search repositories in ${scope()}…`;
    } catch { /* keep the generic placeholder */ }
  }
  void updatePlaceholder();

  return {
    el,
    reset() {
      generation++;
      state = { kind: 'idle' };
      void updatePlaceholder().then(() => { if (input.value.trim()) schedule(); else render(); });
    },
  };
}
