/**
 * A card listing pull requests. "My pull requests" shows live merge / CI / review status (and
 * opens the CI details modal); review queues stay plain: title, repository, author, age.
 */
import {
  fetchPullRequests, fetchPullRequestStatus, pullRequestSearchUrl,
  type PullRequest, type PullRequestKind, type PullRequestStatus,
} from '../../core/pull-requests';
import { LoginRequiredError } from '../../core/github';
import { getSsoOrganizations } from '../../core/sso';
import { esc, timeAgo } from '../../utils/helpers';
import { openCiModal } from './ci-modal';
import { errorChips, loadingChips, renderStatusChips } from './chips';
import { renderEmptyState, type EmptyStateOptions } from './empty-state';
import { ICON_DRAFT, ICON_PULL } from '../icons';

export interface CardController {
  el: HTMLElement;
  refresh(force?: boolean): Promise<void>;
}

interface Options {
  title: string;
  /** Icon shown in front of the title (SVG markup). */
  icon: string;
  kind: PullRequestKind;
  /** Load and show merge / CI / review status per row. */
  showStatus: boolean;
  /** Shown when there is nothing to list. */
  empty: { icon: EmptyStateOptions['icon']; title: string; message: string };
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; signIn: boolean }
  | { kind: 'ready'; items: PullRequest[]; total: number };

const STATUS_TTL_MS = 2 * 60 * 1000;
const CONCURRENCY = 4;
/** Shared across cards and refreshes: a PR's status is reused while its head commit is unchanged. */
const statusCache = new Map<string, { headSha: string; at: number; status: PullRequestStatus }>();

export function createPullRequestCard(options: Options): CardController {
  const el = document.createElement('section');
  el.className = 'aad-card';
  let state: State = { kind: 'loading' };
  let generation = 0;

  const rowHtml = (pr: PullRequest): string => `<li class="aad-pr-row" data-url="${esc(pr.url)}">
    <span class="aad-row-icon aad-row-icon--${pr.isDraft ? 'draft' : 'open'}" title="${pr.isDraft ? 'Draft pull request' : 'Open pull request'}">${pr.isDraft ? ICON_DRAFT : ICON_PULL}</span>
    <a class="aad-pr-title" href="${esc(pr.url)}" title="${esc(pr.title)}" target="_blank" rel="noopener">${esc(pr.title)}</a>
    <div class="aad-pr-meta">${esc(pr.owner)}/${esc(pr.repo)} #${esc(pr.number)}${!options.showStatus && pr.author ? ` · ${esc(pr.author)}` : ''} · ${esc(timeAgo(pr.updatedAt))}</div>
    ${options.showStatus ? `<div class="aad-chips" data-chips>${loadingChips()}</div>` : ''}
  </li>`;

  function body(): string {
    if (state.kind === 'loading') return '<div class="aad-empty">Loading…</div>';
    if (state.kind === 'error') {
      return renderEmptyState(state.signIn
        ? { icon: 'lock', title: 'Sign in to GitHub', message: 'Sign in to see your pull requests.' }
        : { icon: 'alert', title: "Couldn't load pull requests", message: state.message, danger: true });
    }
    if (state.items.length === 0) {
      // The authorize button lives in the dashboard banner; here we only explain the empty state.
      const hidden = getSsoOrganizations().map((o) => o.name);
      if (hidden.length) {
        return renderEmptyState({
          icon: 'lock',
          title: 'Some pull requests may be hidden',
          message: `Private ${hidden.join(', ')} pull requests stay hidden until you authorize SSO.`,
        });
      }
      return renderEmptyState(options.empty);
    }
    const more = state.total > state.items.length
      ? `<div class="aad-hint aad-hint--center">Showing ${state.items.length} of ${state.total} · <a class="aad-link" href="${esc(pullRequestSearchUrl(options.kind))}" target="_blank" rel="noopener">View all</a></div>` : '';
    return `<ul class="aad-list">${state.items.map(rowHtml).join('')}</ul>${more}`;
  }

  function render(): void {
    const count = state.kind === 'ready' ? `<span class="aad-count">${state.total}</span>` : '';
    el.innerHTML = `<header class="aad-card-header">
      <h2><span class="aad-title-icon">${options.icon}</span>${esc(options.title)}${count}</h2>
      <span class="aad-card-actions">
        <a class="aad-link" href="${esc(pullRequestSearchUrl(options.kind))}" target="_blank" rel="noopener">View all</a>
        <button type="button" class="aad-icon-btn" data-refresh title="Refresh" aria-label="Refresh ${esc(options.title)}" ${state.kind === 'loading' ? 'disabled' : ''}>↻</button>
      </span>
    </header><div class="aad-card-body">${body()}</div>`;
  }

  function paintStatus(pr: PullRequest, status: PullRequestStatus | null): void {
    const row = [...el.querySelectorAll<HTMLElement>('.aad-pr-row')].find((r) => r.dataset.url === pr.url);
    const chips = row?.querySelector('[data-chips]');
    if (chips) chips.innerHTML = status ? renderStatusChips(status) : errorChips();
  }

  async function loadStatuses(items: PullRequest[], force: boolean, run: number): Promise<void> {
    const queue = [...items];
    const worker = async (): Promise<void> => {
      for (let pr = queue.shift(); pr; pr = queue.shift()) {
        if (run !== generation) return;
        const hit = statusCache.get(pr.url);
        if (!force && hit && hit.headSha === pr.headSha && Date.now() - hit.at < STATUS_TTL_MS) {
          paintStatus(pr, hit.status);
          continue;
        }
        try {
          const status = await fetchPullRequestStatus(pr);
          statusCache.set(pr.url, { headSha: pr.headSha, at: Date.now(), status });
          if (run === generation) paintStatus(pr, status);
        } catch {
          if (run === generation) paintStatus(pr, null);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  }

  async function refresh(force = false): Promise<void> {
    const run = ++generation;
    state = { kind: 'loading' };
    render();
    try {
      const { items, total } = await fetchPullRequests(options.kind);
      if (run !== generation) return;
      state = { kind: 'ready', items, total };
      render();
      if (options.showStatus) await loadStatuses(items, force, run);
    } catch (error) {
      if (run !== generation) return;
      state = { kind: 'error', message: (error as Error).message || 'Unable to load pull requests', signIn: error instanceof LoginRequiredError };
      render();
    }
  }

  el.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-refresh]')) {
      void refresh(true);
    } else if (target.closest('[data-ci-details]')) {
      const url = target.closest<HTMLElement>('.aad-pr-row')?.dataset.url ?? '';
      const pr = state.kind === 'ready' ? state.items.find((item) => item.url === url) : undefined;
      const cached = statusCache.get(url);
      if (pr && cached) openCiModal(pr, cached.status);
    }
  });
  render();
  return { el, refresh };
}
