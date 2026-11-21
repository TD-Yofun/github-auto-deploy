/** Modal listing every check of a pull request, worst first. */
import type { CheckRun, PullRequest, PullRequestStatus } from '../../core/pull-requests';
import { esc } from '../../utils/helpers';
import { CHECK_ICONS, ICON_CLOSE } from '../icons';
import { lockScroll, unlockScroll } from '../scroll-lock';

const OVERLAY_ID = 'aad-ci-modal';

type Group = 'failed' | 'action' | 'running' | 'passed' | 'skipped';

const GROUPS: { id: Group; label: string; tone: string; icon: string }[] = [
  { id: 'failed', label: 'Failed', tone: 'danger', icon: CHECK_ICONS.failure },
  { id: 'action', label: 'Needs approval', tone: 'attention', icon: CHECK_ICONS.attention },
  { id: 'running', label: 'Running', tone: 'attention', icon: CHECK_ICONS.running },
  { id: 'passed', label: 'Passed', tone: 'success', icon: CHECK_ICONS.success },
  { id: 'skipped', label: 'Skipped', tone: 'muted', icon: CHECK_ICONS.skipped },
];

function groupOf(state: string): Group {
  switch (state) {
    case 'SUCCESS': case 'PASSED': return 'passed';
    case 'FAILURE': case 'FAILED': case 'ERROR': case 'TIMED_OUT': case 'CANCELLED': return 'failed';
    case 'ACTION_REQUIRED': return 'action';
    case 'SKIPPED': case 'NEUTRAL': case 'STALE': return 'skipped';
    default: return 'running'; // PENDING, IN_PROGRESS, QUEUED, EXPECTED, WAITING, unknown
  }
}

const row = (check: CheckRun, group: (typeof GROUPS)[number]): string => {
  const name = check.url
    ? `<a class="aad-check-name" href="${esc(check.url)}" target="_blank" rel="noopener">${esc(check.name)}</a>`
    : `<span class="aad-check-name">${esc(check.name)}</span>`;
  return `<li class="aad-check aad-check--${group.tone}">
    <span class="aad-check-icon" title="${esc(group.label)}">${group.icon}</span>
    <span class="aad-check-main">${name}${check.detail ? `<span class="aad-check-detail">${esc(check.detail)}</span>` : ''}</span>
    ${check.required ? '<span class="aad-chip aad-chip--muted">Required</span>' : ''}
  </li>`;
};

let lastFocus: HTMLElement | null = null;

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  closeCiModal();
}

export function closeCiModal(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  overlay?.remove();
  document.removeEventListener('keydown', onKeydown, true);
  if (overlay) unlockScroll();
  lastFocus?.focus?.();
  lastFocus = null;
}

export function openCiModal(pr: PullRequest, status: PullRequestStatus): void {
  closeCiModal();
  lastFocus = document.activeElement as HTMLElement | null;

  const buckets = new Map<Group, CheckRun[]>(GROUPS.map((g) => [g.id, []]));
  status.checks.forEach((check) => buckets.get(groupOf(check.state))!.push(check));
  const summary = GROUPS.filter((g) => buckets.get(g.id)!.length)
    .map((g) => `<span class="aad-chip aad-chip--${g.tone}">${buckets.get(g.id)!.length} ${g.label.toLowerCase()}</span>`).join('');
  const sections = GROUPS.filter((g) => buckets.get(g.id)!.length).map((g) =>
    `<h3 class="aad-check-group">${esc(g.label)} <span>${buckets.get(g.id)!.length}</span></h3>
     <ul class="aad-check-list">${buckets.get(g.id)!.map((c) => row(c, g)).join('')}</ul>`).join('');

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'aad-modal-overlay';
  overlay.innerHTML = `<div class="aad-modal" role="dialog" aria-modal="true" aria-labelledby="aad-ci-title">
    <div class="aad-modal-header">
      <div class="aad-modal-heading">
        <h2 id="aad-ci-title">Checks</h2>
        <a class="aad-link" href="${esc(pr.url)}" target="_blank" rel="noopener">${esc(pr.owner)}/${esc(pr.repo)} #${esc(pr.number)} · ${esc(pr.title)}</a>
      </div>
      <button type="button" class="aad-icon-btn" data-close title="Close" aria-label="Close">${ICON_CLOSE}</button>
    </div>
    <div class="aad-modal-summary">${summary || '<span class="aad-chip aad-chip--muted">No checks</span>'}</div>
    <div class="aad-modal-body">${sections || '<p class="aad-hint">This pull request has no checks.</p>'}</div>
    <div class="aad-modal-footer"><a class="aad-link" href="${esc(pr.url)}/checks" target="_blank" rel="noopener">Open checks on GitHub</a></div>
  </div>`;

  overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) closeCiModal(); });
  overlay.querySelector('[data-close]')!.addEventListener('click', closeCiModal);
  document.body.appendChild(overlay);
  lockScroll();
  document.addEventListener('keydown', onKeydown, true);
  overlay.querySelector<HTMLElement>('[data-close]')!.focus();
}
