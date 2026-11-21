import './preview.scss';
import { injectStyles } from './ui/styles';
import { initSettings, setUpdateRequired } from './ui/settings';
import { buildUI } from './ui/ui';
import { mountDashboard } from './ui/dashboard/dashboard';
import { loadConfig } from './core/config';

// Minimal Tampermonkey stand-ins so the real UI modules run in a plain browser.
const store = new Map<string, unknown>();
Object.assign(globalThis, {
  GM_getValue: (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
  GM_setValue: (key: string, value: unknown) => { store.set(key, value); },
  GM_addStyle: (css: string) => { const el = document.createElement('style'); el.textContent = css; document.head.append(el); },
  GM_info: { script: { version: '1.0.18' } },
  GM_xmlhttpRequest: (o: { onload: (r: { status: number; responseText: string }) => void }) =>
    setTimeout(() => o.onload({ status: 200, responseText: `// @version      ${new URLSearchParams(location.search).has('outdated') ? '9.9.9' : '1.0.18'}\n` }), 500),
});

// ── Fixtures served by a fake fetch (same shapes as GitHub's embedded JSON / page_data) ──
const params = new URLSearchParams(location.search);
if (!params.has('empty')) store.set('favorite_repos', ['Talkdesk/atlas-apps-configuration', 'Talkdesk/api-gw-configuration', 'Talkdesk/insurer-360-app', 'Talkdesk/client-profile']);
const sso = params.has('sso'); // ?sso → organization SSO not authorized (empty results + banner)
const empty = params.has('empty'); // ?empty → no pull requests at all
const failing = params.has('error'); // ?error → GitHub answers 500

const pr = (n: number, title: string, repo: string, author = 'TD-Yofun', draft = false) => ({
  itemType: 'pull_request', permalink: `https://github.com/${repo}/pull/${n}`, repoNameWithOwner: repo, number: n,
  title, isDraft: draft, headSha: `sha${n}`, updatedAt: new Date(Date.now() - n * 36e5).toISOString(), author: { displayLogin: author },
});
const authored = [
  pr(624, 'Prevent duplicate watchdog recovery', 'Talkdesk/atlas-apps-configuration'),
  pr(319, 'Align production gateway defaults', 'Talkdesk/api-gw-configuration'),
  pr(1452, 'Update launch checklist', 'Talkdesk/insurer-360-app'),
  pr(88, 'WIP: new onboarding flow', 'Talkdesk/client-profile', 'TD-Yofun', true),
  pr(12, 'Bump dependencies', 'Talkdesk/deployments'),
];
const many = params.has('many'); // ?many → long lists next to short ones
const reviewRequested = [
  pr(887, 'Add production environment review', 'Talkdesk/client-profile', 'alice'),
  pr(410, 'Simplify approval status reporting', 'Talkdesk/deployments', 'bob'),
];
const longAuthored = Array.from({ length: 10 }, (_, i) => pr(700 + i, `Feature work item ${i + 1}`, 'Talkdesk/client-profile'));
const mergeBox = (mergeStateStatus: string, reviews: string[] = [], pending = 0, isDraft = false) => ({
  pullRequest: {
    isDraft, mergeStateStatus,
    latestOpinionatedReviews: reviews.map((state) => ({ state })),
    pendingReviewRequests: Array(pending).fill({ reviewer: { login: 'Talkdesk/industries' } }),
  },
  mergeRequirements: {
    conditions: mergeStateStatus === 'BLOCKED'
      ? [{ type: 'PULL_REQUEST_RULES', displayName: 'Repo rules', result: 'FAILED', message: '<div>Waiting on code owner review from Talkdesk/industries. Waiting on code owner review from Talkdesk/industries.</div>' }]
      : [],
  },
});
// GitHub's combinedState is PASSED / FAILED / PENDING (not SUCCESS / FAILURE); keep the fixtures honest.
const checks = (combinedState: string, summary: [number, string][]) => ({
  statusChecks: summary.flatMap(([count, state]) => Array.from({ length: count }, (_, i) => ({
    displayName: `${state === 'SKIPPED' ? 'Deploy' : state === 'FAILURE' ? 'Unit tests' : 'Lint'} / job ${i + 1}`,
    state,
    isRequired: i === 0 && state !== 'SKIPPED',
    additionalContext: state === 'SUCCESS' ? `Successful in ${i + 3}s` : state === 'FAILURE' ? 'Failing after 41s' : state === 'SKIPPED' ? 'Skipped' : 'In progress',
    targetUrl: '/Talkdesk/sample/actions/runs/1',
  }))),
  statusRollup: { combinedState, summary: summary.map(([count, state]) => ({ count, state })) },
});
const status: Record<string, [ReturnType<typeof mergeBox>, ReturnType<typeof checks>]> = {
  624: [mergeBox('CLEAN', ['APPROVED']), checks('PASSED', [[6, 'SUCCESS'], [3, 'SKIPPED']])],
  319: [mergeBox('BLOCKED', [], 2), checks('PENDING', [[3, 'SUCCESS'], [2, 'PENDING']])],
  1452: [mergeBox('DIRTY', ['CHANGES_REQUESTED']), checks('FAILED', [[4, 'SUCCESS'], [1, 'FAILURE']])],
  88: [mergeBox('DRAFT', [], 0, true), checks('PASSED', [[2, 'SUCCESS']])],
  12: [mergeBox('BEHIND', ['APPROVED']), checks('PASSED', [[3, 'SUCCESS']])],
  887: [mergeBox('BLOCKED', [], 1), checks('PASSED', [[5, 'SUCCESS']])],
  410: [mergeBox('BLOCKED'), checks('FAILED', [[1, 'FAILURE']])],
};
const repositories = ['atlas-apps-configuration', 'api-gw-configuration', 'insurer-360-app', 'client-profile', 'deployments', 'github-auto-deploy']
  .map((name, i) => ({ hl_name: `Talkdesk/${name}`, hl_trunc_description: `Description of <em>${name.split('-')[0]}</em> service`, language: i % 2 ? 'Go' : 'TypeScript', archived: i === 4, public: false, repo: { repository: { name, owner_login: 'Talkdesk' } } }));

const page = (payload: unknown) =>
  new Response(`<script data-target="react-app.embeddedData" type="application/json">${JSON.stringify({ payload }).replace(/</g, '\\u003c')}</script>`, { status: 200 });
const ssoLayout = { sso: { sso_organizations: sso ? [{ login: 'Talkdesk', name: 'Talkdesk' }] : [] } };
const delay = <T>(value: T, ms = 250): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input), location.origin);
  const q = decodeURIComponent(url.searchParams.get('q') || '');
  if (failing && url.pathname === '/pulls/search') return delay(new Response('', { status: 500 }), 200);
  if (url.pathname === '/pulls/search') {
    // requested of me → 1 PR; reviews I started → the other one; ?many adds a long list of my own
    const results = sso || empty ? []
      : q.includes('user-review-requested') ? reviewRequested.slice(0, 1)
      : q.includes('reviewed-by') ? reviewRequested.slice(1)
      : many ? [...authored, ...longAuthored] : authored;
    return delay(page({
      pullsDashboardSurfaceContentRoute: { results, pageInfo: { totalCount: results.length } },
      pullsDashboardSurfaceLayoutRoute: ssoLayout,
    }));
  }
  if (url.pathname === '/search') {
    const keyword = q.replace(/org:\S+/g, '').trim().toLowerCase();
    const results = sso ? [] : repositories.filter((r) => r.hl_name.toLowerCase().includes(keyword));
    return delay(page({ blackbirdSearchRoute: { results, protected_org_logins: ['Talkdesk'] } }), 200);
  }
  const match = url.pathname.match(/\/pull\/(\d+)\/page_data\/(merge_box|status_checks)$/);
  if (match && !status[match[1]]) return delay(Response.json({ ...mergeBox('CLEAN', ['APPROVED']), ...{} }), 200);
  if (match && status[match[1]]) return delay(Response.json(status[match[1]][match[2] === 'merge_box' ? 0 : 1]), 300 + Number(match[1]) % 7 * 150);
  return new Response('{}', { status: 404 });
}) as typeof fetch;

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<main class="preview-shell">
  <header class="preview-header"><strong>GitHub</strong><span>Dashboard</span><span>Pull requests</span><span>Issues</span><div class="AppHeader-actions"><div class="AppHeader-user preview-avatar"></div></div></header>
  <div class="application-main"><div class="color-bg-default preview-native">GitHub's original home (hidden while the dashboard is on)</div></div>
</main>`;
document.querySelector('.preview-header')!.setAttribute('data-preview', 'header');

injectStyles();
const config = loadConfig();
initSettings(config, (key) => { if (key === 'homeDashboard') mountDashboard(config.homeDashboard, config.organizations); }, setUpdateRequired);
mountDashboard(true, 'Talkdesk');
if (params.has('panel')) buildUI('123456789', config);
