/** Friendly empty / error state: icon, title, message. */
import { EMPTY_ICONS } from '../icons';
import { esc } from '../../utils/helpers';

export interface EmptyStateOptions {
  icon: keyof typeof EMPTY_ICONS;
  title: string;
  message?: string;
  /** Error styling (red icon). */
  danger?: boolean;
}

export function renderEmptyState({ icon, title, message, danger }: EmptyStateOptions): string {
  return `<div class="aad-empty-state${danger ? ' aad-empty-state--danger' : ''}">
    <span class="aad-empty-icon">${EMPTY_ICONS[icon]}</span>
    <div class="aad-empty-title">${esc(title)}</div>
    ${message ? `<div class="aad-empty-message">${esc(message)}</div>` : ''}
  </div>`;
}
