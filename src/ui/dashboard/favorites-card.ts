/**
 * Favorite repositories: filter by typing, add by typing owner/repo + Enter (or ☆ in the search),
 * reorder by dragging the handle or with ↑/↓ on it. The stored order is the displayed order.
 */
import { addFavorite, getFavorites, moveFavorite, parseRepository, removeFavorite, subscribeFavorites } from '../../core/favorites';
import { esc } from '../../utils/helpers';
import { ICON_GRIP, ICON_REPO, ICON_STAR } from '../icons';
import { renderEmptyState } from './empty-state';
import type { CardController } from './pr-card';

export function createFavoritesCard(): CardController {
  const el = document.createElement('section');
  el.className = 'aad-card';
  el.innerHTML = `<header class="aad-card-header"><h2><span class="aad-title-icon">${ICON_STAR}</span>Favorite repositories<span class="aad-count" data-count></span></h2></header>
    <div class="aad-card-body">
      <input class="aad-input" type="search" data-filter placeholder="Filter, or add owner/repo…" aria-label="Filter or add favorite repositories" autocomplete="off" spellcheck="false">
      <div data-hint class="aad-hint" hidden></div>
      <div data-list></div>
    </div>`;

  const input = el.querySelector<HTMLInputElement>('[data-filter]')!;
  const hint = el.querySelector<HTMLElement>('[data-hint]')!;
  const list = el.querySelector<HTMLElement>('[data-list]')!;
  const count = el.querySelector<HTMLElement>('[data-count]')!;

  /** Repository to re-focus after a keyboard move re-rendered the list. */
  let refocus: string | null = null;

  function render(): void {
    const all = getFavorites();
    const query = input.value.trim().toLowerCase();
    const shown = query ? all.filter((f) => f.toLowerCase().includes(query)) : all;
    count.textContent = all.length ? String(all.length) : '';

    const candidate = parseRepository(input.value);
    const addable = !!candidate && !all.some((f) => f.toLowerCase() === candidate.toLowerCase());
    hint.hidden = !addable;
    hint.textContent = addable ? `Press Enter to add ${candidate}` : '';

    if (shown.length === 0) {
      list.innerHTML = all.length === 0
        ? renderEmptyState({ icon: 'star', title: 'No favorites yet', message: 'Click ☆ on a search result, or type owner/repo above and press Enter.' })
        : renderEmptyState({ icon: 'search', title: 'No matching favorites', message: addable ? `Press Enter to add ${candidate}.` : 'Try a different keyword.' });
      return;
    }
    // Rows of a filtered list do not map onto positions of the full list, so reordering is off.
    const sortable = !query && all.length > 1;
    list.innerHTML = `<ul class="aad-list">${shown.map((name) => `<li class="aad-fav-row" data-name="${esc(name)}">
      ${sortable ? `<button type="button" class="aad-grip" data-grip="${esc(name)}" title="Drag to reorder (or use ↑ ↓)" aria-label="Reorder ${esc(name)}: drag, or press Arrow Up or Arrow Down">${ICON_GRIP}</button>` : ''}
      <span class="aad-row-icon" aria-hidden="true">${ICON_REPO}</span>
      <div class="aad-fav-main">
        <a class="aad-fav-name" href="https://github.com/${esc(name)}" title="${esc(name)}" target="_blank" rel="noopener">${esc(name)}</a>
        <span class="aad-fav-links">
          <a class="aad-link" href="https://github.com/${esc(name)}/pulls" target="_blank" rel="noopener">PRs</a>
          <a class="aad-link" href="https://github.com/${esc(name)}/actions" target="_blank" rel="noopener">Actions</a>
        </span>
      </div>
      <button type="button" class="aad-icon-btn" data-remove="${esc(name)}" title="Remove from favorites" aria-label="Remove ${esc(name)} from favorites">×</button>
    </li>`).join('')}</ul>`;

    if (refocus) {
      list.querySelector<HTMLElement>(`[data-grip="${CSS.escape(refocus)}"]`)?.focus();
      refocus = null;
    }
  }

  // ── Drag and drop (HTML5). Rows become draggable only while the handle is pressed, so the
  //    links and text inside a row can still be selected and clicked normally. ──
  let dragged: string | null = null;
  let dropPosition = -1;

  const rows = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>('.aad-fav-row')];
  const clearMarkers = (): void => rows().forEach((r) => r.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
  const endDrag = (): void => {
    rows().forEach((r) => { r.draggable = false; });
    clearMarkers();
    dragged = null;
    dropPosition = -1;
  };

  list.addEventListener('mousedown', (event) => {
    const grip = (event.target as HTMLElement).closest('.aad-grip');
    if (grip) grip.closest<HTMLElement>('.aad-fav-row')!.draggable = true;
  });
  list.addEventListener('mouseup', () => rows().forEach((r) => { r.draggable = false; }));

  list.addEventListener('dragstart', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('.aad-fav-row');
    if (!row || !event.dataTransfer) return;
    dragged = row.dataset.name ?? null;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragged ?? '');
    row.classList.add('is-dragging');
  });

  list.addEventListener('dragover', (event) => {
    if (!dragged) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const all = rows();
    // The gap nearest to the pointer: before the first row whose midpoint is below it.
    let position = all.length;
    for (let i = 0; i < all.length; i++) {
      const box = all[i].getBoundingClientRect();
      if (event.clientY < box.top + box.height / 2) { position = i; break; }
    }
    if (position === dropPosition) return;
    dropPosition = position;
    all.forEach((r) => r.classList.remove('is-drop-before', 'is-drop-after'));
    if (position < all.length) all[position].classList.add('is-drop-before');
    else all[all.length - 1].classList.add('is-drop-after');
  });

  list.addEventListener('drop', (event) => {
    if (!dragged) return;
    event.preventDefault();
    const name = dragged;
    const position = dropPosition;
    endDrag();
    if (position >= 0) moveFavorite(name, position);
  });
  list.addEventListener('dragend', endDrag);

  // ── Keyboard: ↑ / ↓ on a focused handle moves that favorite one place. ──
  list.addEventListener('keydown', (event) => {
    const grip = (event.target as HTMLElement).closest<HTMLElement>('.aad-grip');
    if (!grip || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const name = grip.dataset.grip!;
    const index = getFavorites().findIndex((f) => f.toLowerCase() === name.toLowerCase());
    refocus = name;
    // Positions are gaps: one place up is the gap before the previous row, one down is after the next.
    moveFavorite(name, event.key === 'ArrowUp' ? index - 1 : index + 2);
    if (refocus) { // nothing moved (already at the edge): no re-render happened
      grip.focus();
      refocus = null;
    }
  });

  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (addFavorite(input.value)) input.value = '';
    render();
  });
  list.addEventListener('click', (event) => {
    const name = (event.target as HTMLElement).closest<HTMLElement>('[data-remove]')?.dataset.remove;
    if (name) removeFavorite(name);
  });
  subscribeFavorites(render);
  render();
  return { el, refresh: async () => render() };
}
