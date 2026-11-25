/**
 * Favorite repositories: tabs by tag (All first), filter by typing, add by typing owner/repo + Enter
 * (or ☆ in the search), tag from the tag button on a row, reorder by dragging the handle or with
 * ↑/↓ on it. The stored order is the displayed order.
 *
 * A row shows only the repository name and its tags; the drag handle, PR / Actions shortcuts and
 * the tag / remove buttons appear on hover or keyboard focus, so the list stays quiet.
 */
import {
  addFavorite, addTag, getFavorites, getTags, hasTag, listTags, MAX_TAG_LENGTH, moveFavorite,
  parseRepository, removeFavorite, removeTag, subscribeFavorites,
} from '../../core/favorites';
import { esc } from '../../utils/helpers';
import { ICON_GRIP, ICON_PLAY_CIRCLE, ICON_PULL, ICON_STAR, ICON_TAG } from '../icons';
import { renderEmptyState } from './empty-state';
import type { CardController } from './pr-card';

export function createFavoritesCard(): CardController {
  const el = document.createElement('section');
  el.className = 'aad-card';
  el.innerHTML = `<header class="aad-card-header"><h2><span class="aad-title-icon">${ICON_STAR}</span>Favorite repositories<span class="aad-count" data-count></span></h2></header>
    <div class="aad-card-body">
      <div class="aad-tabs-wrap"><div class="aad-tabs" role="tablist" aria-label="Filter favorites by tag" data-tabs></div></div>
      <input class="aad-input" type="search" data-filter placeholder="Filter, or add owner/repo…" aria-label="Filter or add favorite repositories" autocomplete="off" spellcheck="false">
      <div data-hint class="aad-hint" hidden></div>
      <div data-list></div>
    </div>`;

  const input = el.querySelector<HTMLInputElement>('[data-filter]')!;
  const hint = el.querySelector<HTMLElement>('[data-hint]')!;
  const list = el.querySelector<HTMLElement>('[data-list]')!;
  const count = el.querySelector<HTMLElement>('[data-count]')!;
  const tabs = el.querySelector<HTMLElement>('[data-tabs]')!;

  /** Selected tag tab; null is "All". Not persisted: the card always opens on All. */
  let activeTag: string | null = null;
  /** Repository whose tag editor is open. */
  let editing: string | null = null;
  /** Repository to re-focus after a keyboard move re-rendered the list. */
  let refocus: string | null = null;
  /** Put the cursor back in the tag input after a re-render (adding several tags in a row). */
  let refocusEditor = false;

  const sameTag = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

  function renderTabs(): void {
    const all = getFavorites();
    const tags = listTags();
    // The selected tag disappears when its last repository loses it (or is removed): back to All.
    if (activeTag && !tags.some((t) => sameTag(t.tag, activeTag!))) activeTag = null;
    const items = [{ tag: null as string | null, label: 'All', count: all.length }, ...tags.map((t) => ({ tag: t.tag as string | null, label: t.tag, count: t.count }))];
    tabs.innerHTML = items.map((item) => {
      const on = item.tag === null ? activeTag === null : activeTag !== null && sameTag(activeTag, item.tag);
      return `<button type="button" role="tab" class="aad-tab${on ? ' is-active' : ''}" data-tab="${item.tag === null ? '' : esc(item.tag)}" aria-selected="${on}" tabindex="${on ? 0 : -1}" title="${item.tag === null ? 'All favorites' : `Tag: ${esc(item.tag)}`}"><span class="aad-tab-label">${esc(item.label)}</span><span class="aad-tab-count">${item.count}</span></button>`;
    }).join('');
    layoutTabs();
  }

  /** One row while every tab fits; otherwise two rows (filled column by column) that scroll sideways. */
  function layoutTabs(): void {
    tabs.dataset.rows = '1';
    if (tabs.scrollWidth > tabs.clientWidth + 1) tabs.dataset.rows = '2';
    updateFade();
  }

  /** Edge fades tell the user there are more tags to scroll to on that side. */
  function updateFade(): void {
    const max = tabs.scrollWidth - tabs.clientWidth;
    const more = { left: tabs.scrollLeft > 1, right: tabs.scrollLeft < max - 1 };
    tabs.dataset.fade = max <= 1 ? 'none' : more.left && more.right ? 'both' : more.left ? 'left' : more.right ? 'right' : 'none';
  }

  /** Bring the selected tab fully into view (only on selection, so manual scrolling is not undone). */
  function revealActiveTab(): void {
    const tab = tabs.querySelector<HTMLElement>('.aad-tab.is-active');
    if (!tab) return;
    const margin = 32; // clear of the fade
    if (tab.offsetLeft - margin < tabs.scrollLeft) tabs.scrollLeft = Math.max(0, tab.offsetLeft - margin);
    else if (tab.offsetLeft + tab.offsetWidth + margin > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = tab.offsetLeft + tab.offsetWidth + margin - tabs.clientWidth;
    updateFade();
  }

  tabs.addEventListener('scroll', updateFade, { passive: true });
  new ResizeObserver(layoutTabs).observe(tabs);
  // A plain mouse wheel scrolls the strip sideways while it can; at either end the page scrolls on.
  tabs.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || tabs.scrollWidth <= tabs.clientWidth) return;
    const max = tabs.scrollWidth - tabs.clientWidth;
    if (event.deltaY > 0 ? tabs.scrollLeft >= max - 1 : tabs.scrollLeft <= 0) return;
    event.preventDefault();
    // Wheel deltas are pixels, lines (some mice / Firefox) or pages.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? tabs.clientWidth : 1;
    tabs.scrollLeft += event.deltaY * unit;
  }, { passive: false });

  function editorHtml(name: string): string {
    const own = getTags(name);
    const suggestions = listTags().filter((t) => !own.some((o) => sameTag(o, t.tag)));
    return `<div class="aad-tag-editor">
      ${own.length ? `<div class="aad-tag-list">${own.map((t) => `<span class="aad-tag aad-tag--removable">${esc(t)}<button type="button" data-remove-tag="${esc(t)}" data-repo="${esc(name)}" title="Remove tag ${esc(t)}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join('')}</div>` : ''}
      <input class="aad-tag-input" type="text" data-tag-input="${esc(name)}" maxlength="${MAX_TAG_LENGTH}" placeholder="Add a tag and press Enter" aria-label="Add a tag to ${esc(name)}" autocomplete="off" spellcheck="false">
      ${suggestions.length ? `<div class="aad-tag-list aad-tag-suggestions"><span class="aad-hint">Existing:</span>${suggestions.map((t) => `<button type="button" class="aad-tag" data-add-tag="${esc(t.tag)}" data-repo="${esc(name)}" title="Add tag ${esc(t.tag)}">+ ${esc(t.tag)}</button>`).join('')}</div>` : ''}
    </div>`;
  }

  function render(): void {
    const all = getFavorites();
    renderTabs();
    const query = input.value.trim().toLowerCase();
    const inTab = activeTag ? all.filter((f) => hasTag(f, activeTag!)) : all;
    const shown = query ? inTab.filter((f) => f.toLowerCase().includes(query)) : inTab;
    count.textContent = all.length ? String(all.length) : '';

    const candidate = parseRepository(input.value);
    const addable = !!candidate && !all.some((f) => f.toLowerCase() === candidate.toLowerCase());
    hint.hidden = !addable;
    hint.textContent = addable ? `Press Enter to add ${candidate}${activeTag ? ` (tagged ${activeTag})` : ''}` : '';

    if (shown.length === 0) {
      list.innerHTML = all.length === 0
        ? renderEmptyState({ icon: 'star', title: 'No favorites yet', message: 'Click ☆ on a search result, or type owner/repo above and press Enter.' })
        : renderEmptyState({ icon: 'search', title: 'No matching favorites', message: addable ? `Press Enter to add ${candidate}.` : 'Try a different keyword.' });
      return;
    }
    // Rows of a filtered or tagged list do not map onto positions of the full list, so reordering is off.
    const sortable = !query && !activeTag && all.length > 1;
    list.innerHTML = `<ul class="aad-list">${shown.map((name) => {
      const tags = getTags(name);
      const open = editing !== null && editing.toLowerCase() === name.toLowerCase();
      return `<li class="aad-fav-row${open ? ' is-editing' : ''}" data-name="${esc(name)}">
      <div class="aad-fav-line">
      ${sortable ? `<button type="button" class="aad-grip" data-grip="${esc(name)}" title="Drag to reorder (or use ↑ ↓)" aria-label="Reorder ${esc(name)}: drag, or press Arrow Up or Arrow Down">${ICON_GRIP}</button>` : ''}
      <div class="aad-fav-main">
        <a class="aad-fav-name" href="https://github.com/${esc(name)}" title="${esc(name)}" target="_blank" rel="noopener"><span class="aad-fav-owner">${esc(name.split('/')[0])}/</span>${esc(name.split('/')[1])}</a>
        ${tags.length ? `<span class="aad-fav-tags">${tags.map((t) => `<button type="button" class="aad-tag" data-tag-chip="${esc(t)}" title="Show tag ${esc(t)}">${esc(t)}</button>`).join('')}</span>` : ''}
      </div>
      <div class="aad-fav-actions">
        <a class="aad-icon-btn" href="https://github.com/${esc(name)}/pulls" target="_blank" rel="noopener" title="Pull requests" aria-label="Pull requests of ${esc(name)}">${ICON_PULL}</a>
        <a class="aad-icon-btn" href="https://github.com/${esc(name)}/actions" target="_blank" rel="noopener" title="Actions" aria-label="Actions of ${esc(name)}">${ICON_PLAY_CIRCLE}</a>
        <button type="button" class="aad-icon-btn${open ? ' is-on' : ''}" data-edit-tags="${esc(name)}" aria-expanded="${open}" title="Edit tags" aria-label="Edit tags of ${esc(name)}">${ICON_TAG}</button>
        <button type="button" class="aad-icon-btn" data-remove="${esc(name)}" title="Remove from favorites" aria-label="Remove ${esc(name)} from favorites">×</button>
      </div>
      </div>
      ${open ? editorHtml(name) : ''}
    </li>`;
    }).join('')}</ul>`;

    if (refocus) {
      list.querySelector<HTMLElement>(`[data-grip="${CSS.escape(refocus)}"]`)?.focus();
      refocus = null;
    }
    if (refocusEditor) {
      list.querySelector<HTMLInputElement>('[data-tag-input]')?.focus();
      refocusEditor = false;
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
    const name = parseRepository(input.value);
    if (name && addFavorite(name)) {
      if (activeTag) addTag(name, activeTag); // added from a tag tab: it belongs to that tag
      input.value = '';
    }
    render();
  });

  const selectTab = (tag: string | null): void => {
    activeTag = tag;
    editing = null;
    render();
    revealActiveTab();
  };

  el.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const get = (attr: string) => target.closest<HTMLElement>(`[${attr}]`);

    const tab = get('data-tab');
    if (tab) { selectTab(tab.dataset.tab ? tab.dataset.tab : null); return; }
    const chip = get('data-tag-chip');
    if (chip) { selectTab(chip.dataset.tagChip ?? null); return; }

    const remove = get('data-remove')?.dataset.remove;
    if (remove) { removeFavorite(remove); return; }

    const edit = get('data-edit-tags')?.dataset.editTags;
    if (edit) {
      editing = editing && editing.toLowerCase() === edit.toLowerCase() ? null : edit;
      refocusEditor = editing !== null;
      render();
      return;
    }
    const removeFrom = get('data-remove-tag');
    if (removeFrom) { refocusEditor = true; removeTag(removeFrom.dataset.repo!, removeFrom.dataset.removeTag!); return; }
    const suggestion = get('data-add-tag');
    if (suggestion) { refocusEditor = true; addTag(suggestion.dataset.repo!, suggestion.dataset.addTag!); }
  });

  // Tag input: Enter adds, Esc closes the editor.
  el.addEventListener('keydown', (event) => {
    const field = (event.target as HTMLElement).closest<HTMLInputElement>('[data-tag-input]');
    if (field) {
      if (event.key === 'Enter') {
        event.preventDefault();
        refocusEditor = true;
        if (!addTag(field.dataset.tagInput!, field.value)) { refocusEditor = false; field.value = ''; }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        const name = editing;
        editing = null;
        render();
        if (name) list.querySelector<HTMLElement>(`[data-edit-tags="${CSS.escape(name)}"]`)?.focus();
      }
      return;
    }
    // Tabs: ←/→ and Home/End move the selection (roving tabindex), like the settings menu.
    const tab = (event.target as HTMLElement).closest<HTMLElement>('.aad-tab');
    if (!tab) return;
    const buttons = [...tabs.querySelectorAll<HTMLElement>('.aad-tab')];
    const index = buttons.indexOf(tab);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % buttons.length : event.key === 'ArrowLeft' ? (index - 1 + buttons.length) % buttons.length : -1;
    if (target < 0) return;
    event.preventDefault();
    const next = buttons[target].dataset.tab;
    selectTab(next ? next : null);
    tabs.querySelector<HTMLElement>('.aad-tab.is-active')?.focus({ preventScroll: true });
  });

  subscribeFavorites(render);
  render();
  return { el, refresh: async () => render() };
}
