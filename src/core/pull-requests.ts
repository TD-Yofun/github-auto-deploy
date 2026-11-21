/**
 * Pull request discovery and status through GitHub's authenticated web endpoints.
 *  - Lists come from the embedded JSON of `/pulls/search`.
 *  - CI / review / mergeability come from the same `page_data/*` endpoints the PR page uses.
 */
import { fetchEmbeddedPayload, fetchJson } from './github';
import { reportSsoOrganizations } from './sso';

/**
 * - `authored`: my open pull requests.
 * - `review`: what is on my plate as a reviewer — requests addressed to me personally, plus pull
 *   requests I already started reviewing that are not approved yet. Team requests (CODEOWNERS
 *   routes hundreds to a team) are deliberately left out.
 */
export type PullRequestKind = 'authored' | 'review';

const BASE = 'is:pr state:open archived:false sort:updated-desc';

const queries = {
  authored: `${BASE} author:@me`,
  /** Asked of me personally; a team request that merely includes me does not match. */
  requested: `${BASE} user-review-requested:@me`,
  /** I submitted a review, it is not my own PR, and it is not approved yet. */
  reviewing: `${BASE} reviewed-by:@me -author:@me -review:approved`,
};

export interface PullRequest {
  owner: string;
  repo: string;
  number: string;
  title: string;
  url: string;
  isDraft: boolean;
  headSha: string;
  updatedAt: string;
  author: string;
}

export interface PullRequestList {
  items: PullRequest[];
  total: number;
}

const searchUrl = (query: string, page = 1): string =>
  `/pulls/search?q=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`;

/** Where "View all" should lead for each kind. */
export const pullRequestSearchUrl = (kind: PullRequestKind): string =>
  searchUrl(kind === 'authored' ? queries.authored : queries.requested);

interface RawResult {
  itemType?: string;
  permalink: string;
  repoNameWithOwner: string;
  number: number;
  title: string;
  isDraft?: boolean;
  headSha?: string;
  updatedAt?: string;
  author?: { displayLogin?: string };
}

interface SearchPayload {
  pullsDashboardSurfaceContentRoute: { results: RawResult[]; pageInfo?: { totalCount?: number } };
  pullsDashboardSurfaceLayoutRoute?: { sso?: { sso_organizations?: { login: string; name?: string }[] } };
}

const toPullRequest = (r: RawResult): PullRequest => {
  const [owner, repo] = r.repoNameWithOwner.split('/');
  return {
    owner, repo,
    number: String(r.number),
    title: r.title,
    url: r.permalink,
    isDraft: !!r.isDraft,
    headSha: r.headSha || '',
    updatedAt: r.updatedAt || '',
    author: r.author?.displayLogin || '',
  };
};

/** One or more result pages of a search query (25 per page). */
async function searchPages(query: string, maxPages: number): Promise<{ items: PullRequest[]; total: number }> {
  const items: PullRequest[] = [];
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const payload = await fetchEmbeddedPayload<SearchPayload>(searchUrl(query, page));
    if (page === 1) {
      const sso = payload.pullsDashboardSurfaceLayoutRoute?.sso?.sso_organizations ?? [];
      reportSsoOrganizations(sso.map((o) => ({ login: o.login, name: o.name || o.login })));
    }
    const content = payload.pullsDashboardSurfaceContentRoute;
    total = content.pageInfo?.totalCount ?? 0;
    items.push(...content.results.filter((r) => !r.itemType || r.itemType === 'pull_request').map(toPullRequest));
    if (items.length >= total || content.results.length === 0) break;
  }
  return { items, total };
}

const LIST_LIMIT = 10;
const REVIEW_LIMIT = 20;

export async function fetchPullRequests(kind: PullRequestKind): Promise<PullRequestList> {
  if (kind === 'authored') {
    const { items, total } = await searchPages(queries.authored, 1);
    return { items: items.slice(0, LIST_LIMIT), total };
  }
  const [requested, reviewing] = await Promise.all([searchPages(queries.requested, 2), searchPages(queries.reviewing, 2)]);
  // Requests first. A PR can match both (re-requested after I reviewed): list it once.
  const seen = new Set(requested.items.map((pr) => pr.url));
  const items = [...requested.items, ...reviewing.items.filter((pr) => !seen.has(pr.url))];
  const unfetched = Math.max(0, requested.total - requested.items.length) + Math.max(0, reviewing.total - reviewing.items.length);
  return { items: items.slice(0, REVIEW_LIMIT), total: items.length + unfetched };
}

// ── Status ─────────────────────────────────────────────────

export type MergeState = 'ready' | 'unstable' | 'conflicts' | 'behind' | 'blocked' | 'draft' | 'unknown';
export type CiState = 'success' | 'failure' | 'pending' | 'approval' | 'none';
export type ReviewState = 'approved' | 'changes_requested' | 'required' | 'none';

/** One entry of the PR's check list (workflow job, commit status, external CI…). */
export interface CheckRun {
  name: string;
  /** GitHub's raw state: SUCCESS, FAILURE, PENDING, SKIPPED, ACTION_REQUIRED, … */
  state: string;
  required: boolean;
  /** e.g. "Successful in 6s". */
  detail: string;
  /** Link to the check's logs (absolute). Empty when GitHub gave none. */
  url: string;
}

export interface PullRequestStatus {
  merge: MergeState;
  ci: CiState;
  /** e.g. "13 passed · 7 skipped" */
  ciDetail: string;
  review: ReviewState;
  /** Who a pending review request is waiting on: logins, or `org/team` for team requests. */
  reviewers: string[];
  /** Why the pull request cannot be merged, in GitHub's own words (first failed requirement). */
  blockedReason: string;
  checks: CheckRun[];
}

interface MergeBoxJson {
  pullRequest?: {
    isDraft?: boolean;
    mergeStateStatus?: string;
    latestOpinionatedReviews?: { state?: string }[];
    pendingReviewRequests?: { reviewer?: { login?: string } }[];
  };
  mergeRequirements?: { conditions?: { type?: string; displayName?: string; message?: string | null; result?: string }[] };
}

interface StatusChecksJson {
  statusChecks?: {
    displayName?: string;
    state?: string;
    isRequired?: boolean;
    additionalContext?: string | null;
    description?: string | null;
    targetUrl?: string | null;
  }[];
  statusRollup?: { combinedState?: string; summary?: { count: number; state: string }[] };
}

const MERGE_STATES: Record<string, MergeState> = {
  CLEAN: 'ready',
  HAS_HOOKS: 'ready',
  UNSTABLE: 'unstable',
  DIRTY: 'conflicts',
  BEHIND: 'behind',
  BLOCKED: 'blocked',
  DRAFT: 'draft',
};

const CI_LABELS: Record<string, string> = {
  SUCCESS: 'passed',
  PASSED: 'passed',
  FAILURE: 'failed',
  FAILED: 'failed',
  ERROR: 'failed',
  TIMED_OUT: 'timed out',
  CANCELLED: 'cancelled',
  PENDING: 'running',
  IN_PROGRESS: 'running',
  QUEUED: 'queued',
  EXPECTED: 'waiting',
  SKIPPED: 'skipped',
  NEUTRAL: 'neutral',
  ACTION_REQUIRED: 'need approval',
};

const FAILING = ['FAILURE', 'FAILED', 'ERROR', 'TIMED_OUT', 'CANCELLED'];
const RUNNING = ['PENDING', 'IN_PROGRESS', 'QUEUED', 'EXPECTED', 'WAITING'];

/**
 * GitHub's `combinedState` uses PASSED / FAILED / PENDING / PENDING_APPROVAL (not the REST API's
 * SUCCESS / FAILURE), so the per-state `summary` counts are the primary signal.
 */
function ciFrom(checks: StatusChecksJson | null): Pick<PullRequestStatus, 'ci' | 'ciDetail'> {
  const rollup = checks?.statusRollup;
  const summary = rollup?.summary ?? [];
  if (!rollup || (!summary.length && !rollup.combinedState)) return { ci: 'none', ciDetail: 'No checks' };

  const count = (states: string[]) => summary.filter((s) => states.includes(s.state)).reduce((n, s) => n + s.count, 0);
  const ciDetail = summary.map((s) => `${s.count} ${CI_LABELS[s.state] ?? s.state.toLowerCase()}`).join(' · ');
  const combined = rollup.combinedState ?? '';

  if (count(FAILING) > 0) return { ci: 'failure', ciDetail };
  if (count(['ACTION_REQUIRED']) > 0 || combined === 'PENDING_APPROVAL') return { ci: 'approval', ciDetail };
  if (count(RUNNING) > 0) return { ci: 'pending', ciDetail };
  if (summary.length > 0) return { ci: 'success', ciDetail };
  // No per-state counts: fall back to the combined state.
  if (['PASSED', 'SUCCESS'].includes(combined)) return { ci: 'success', ciDetail };
  if (['FAILED', 'FAILURE', 'ERROR'].includes(combined)) return { ci: 'failure', ciDetail };
  return { ci: 'pending', ciDetail };
}

function checksFrom(checks: StatusChecksJson | null): CheckRun[] {
  return (checks?.statusChecks ?? []).map((c) => ({
    name: c.displayName || 'Check',
    state: c.state || 'UNKNOWN',
    required: !!c.isRequired,
    detail: (c.additionalContext || c.description || '').trim(),
    url: c.targetUrl ? new URL(c.targetUrl, location.origin).href : '',
  }));
}

function reviewFrom(pr: MergeBoxJson['pullRequest']): ReviewState {
  const states = (pr?.latestOpinionatedReviews ?? []).map((r) => r.state);
  if (states.includes('CHANGES_REQUESTED')) return 'changes_requested';
  if (states.includes('APPROVED')) return 'approved';
  return (pr?.pendingReviewRequests?.length ?? 0) > 0 ? 'required' : 'none';
}

/** First failed requirement's message as plain text, with GitHub's repeated sentences collapsed. */
function blockedReasonFrom(conditions: NonNullable<MergeBoxJson['mergeRequirements']>['conditions']): string {
  // "User cannot push" describes the viewer, not the pull request.
  const failed = (conditions ?? []).find((c) => c.result === 'FAILED' && c.type !== 'PULL_REQUEST_USER_STATE');
  if (!failed) return '';
  const text = (failed.message ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const sentences = [...new Set(text.split(/(?<=\.)\s+/).filter(Boolean))];
  return (sentences.join(' ') || failed.displayName || '').slice(0, 200);
}

/** Pure mapping from GitHub's two JSON documents to what the dashboard shows. */
export function deriveStatus(mergeBox: MergeBoxJson | null, checks: StatusChecksJson | null): PullRequestStatus {
  const pr = mergeBox?.pullRequest;
  const merge: MergeState = pr?.isDraft ? 'draft' : MERGE_STATES[pr?.mergeStateStatus ?? ''] ?? 'unknown';
  const reviewers = [...new Set((pr?.pendingReviewRequests ?? []).map((r) => r.reviewer?.login).filter((l): l is string => !!l))];
  return {
    merge,
    review: reviewFrom(pr),
    reviewers,
    blockedReason: blockedReasonFrom(mergeBox?.mergeRequirements?.conditions),
    checks: checksFrom(checks),
    ...ciFrom(checks),
  };
}

export async function fetchPullRequestStatus(pr: PullRequest): Promise<PullRequestStatus> {
  const base = `/${pr.owner}/${pr.repo}/pull/${pr.number}/page_data`;
  const [mergeBox, checks] = await Promise.allSettled([
    fetchJson<MergeBoxJson>(`${base}/merge_box?merge_method=SQUASH&bypass_requirements=false`),
    fetchJson<StatusChecksJson>(`${base}/status_checks`),
  ]);
  if (mergeBox.status === 'rejected' && checks.status === 'rejected') throw mergeBox.reason;
  return deriveStatus(
    mergeBox.status === 'fulfilled' ? mergeBox.value : null,
    checks.status === 'fulfilled' ? checks.value : null,
  );
}

