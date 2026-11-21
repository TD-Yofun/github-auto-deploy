/** Status chips for a row of "My open pull requests". */
import type { PullRequestStatus } from '../../core/pull-requests';
import { esc } from '../../utils/helpers';
import { CHECK_ICONS, ICON_CLOCK, ICON_DRAFT, ICON_EYE, ICON_INFO, ICON_WARNING } from '../icons';

type Tone = 'success' | 'danger' | 'attention' | 'muted';

const chip = (tone: Tone, label: string, icon: string, title = ''): string =>
  `<span class="aad-chip aad-chip--${tone}"${title ? ` title="${esc(title)}"` : ''}>${icon}${esc(label)}</span>`;

/** The CI chip is a button: it opens the list of every check. */
const ciChip = (tone: Tone, label: string, icon: string, detail: string): string =>
  `<button type="button" class="aad-chip aad-chip--${tone} aad-chip--button" data-ci-details title="${esc(detail ? `${detail} — click for details` : 'Click for details')}">${icon}${esc(label)} ›</button>`;

/** "Talkdesk/industries" or "a, b" or "a, b +2". */
const names = (reviewers: string[]): string =>
  reviewers.length > 2 ? `${reviewers.slice(0, 2).join(', ')} +${reviewers.length - 2}` : reviewers.join(', ');

export function renderStatusChips(status: PullRequestStatus): string {
  const chips: string[] = [];
  // When a review request is why a PR is blocked, say who it waits on instead of a bare
  // "Blocked" plus "Review required".
  const waitingOnReview = status.merge === 'blocked' && status.review === 'required' && status.reviewers.length > 0;

  switch (status.merge) {
    case 'draft': chips.push(chip('muted', 'Draft', ICON_DRAFT)); break;
    case 'ready': chips.push(chip('success', 'Ready to merge', CHECK_ICONS.success)); break;
    case 'unstable': chips.push(chip('attention', 'Mergeable, checks failing', ICON_WARNING)); break;
    case 'conflicts': chips.push(chip('danger', 'Conflicts', ICON_WARNING, 'The branch has merge conflicts')); break;
    case 'behind': chips.push(chip('attention', 'Behind base', ICON_WARNING, 'The branch is out of date with the base branch')); break;
    case 'blocked':
      chips.push(waitingOnReview
        ? chip('attention', `Awaiting ${names(status.reviewers)}`, ICON_CLOCK, status.blockedReason)
        : chip('attention', 'Blocked', ICON_WARNING, status.blockedReason));
      break;
    default: chips.push(chip('muted', 'Merge status unknown', ICON_INFO));
  }

  switch (status.ci) {
    case 'success': chips.push(ciChip('success', 'CI passed', CHECK_ICONS.success, status.ciDetail)); break;
    case 'failure': chips.push(ciChip('danger', 'CI failed', CHECK_ICONS.failure, status.ciDetail)); break;
    case 'pending': chips.push(ciChip('attention', 'CI running', ICON_CLOCK, status.ciDetail)); break;
    case 'approval': chips.push(ciChip('attention', 'CI needs approval', ICON_WARNING, status.ciDetail)); break;
    default: break;
  }

  switch (status.review) {
    case 'approved': chips.push(chip('success', 'Approved', CHECK_ICONS.success)); break;
    case 'changes_requested': chips.push(chip('danger', 'Changes requested', CHECK_ICONS.failure)); break;
    case 'required': if (!waitingOnReview) chips.push(chip('muted', 'Review required', ICON_EYE)); break;
    default: break;
  }

  return chips.join('');
}

export const loadingChips = (): string => '<span class="aad-chip aad-chip--muted">Checking status…</span>';
export const errorChips = (): string => '<span class="aad-chip aad-chip--muted" title="Could not load CI / merge status">Status unavailable</span>';
