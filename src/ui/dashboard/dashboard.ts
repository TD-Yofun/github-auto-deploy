/**
 * Work dashboard that replaces GitHub's home page: repository search on top, then cards for
 * favorite repositories, my open pull requests and review requests. GitHub's own home content is
 * only hidden (a class on <html>), so turning the dashboard off restores the original page.
 */
import { getSsoOrganizations, subscribeSso } from '../../core/sso';
import { ICON_EYE, ICON_PULL } from '../icons';
import { createFavoritesCard } from './favorites-card';
import { createPullRequestCard, type CardController } from './pr-card';
import { createSearchBox, type SearchBox } from './search-box';
import { renderSsoNotice } from './sso-notice';

const ROOT_ID = 'aad-dashboard';
const HOME_CLASS = 'aad-home';
const STALE_AFTER_MS = 3 * 60 * 1000;

interface Dashboard {
  root: HTMLElement;
  cards: CardController[];
  search: SearchBox;
  loadedAt: number;
}

let dashboard: Dashboard | null = null;
let observer: MutationObserver | null = null;
let organizationSetting = '';

function build(): Dashboard {
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.innerHTML = `<h1 class="aad-sr-only">Work dashboard</h1>
    <div class="aad-dash-top" data-search></div>
    <div data-sso></div>
    <div class="aad-dash-grid" data-grid></div>`;

  const search = createSearchBox(() => organizationSetting);
  root.querySelector('[data-search]')!.append(search.el);

  const mine = createPullRequestCard({
    title: 'My open pull requests',
    icon: ICON_PULL,
    kind: 'authored',
    showStatus: true,
    empty: { icon: 'check', title: 'All clear', message: 'You have no open pull requests.' },
  });
  const reviews = createPullRequestCard({
    title: 'Review requested',
    icon: ICON_EYE,
    kind: 'review',
    showStatus: false,
    empty: { icon: 'inbox', title: 'Nothing to review', message: 'Nobody asked you personally, and you have no review in progress.' },
  });
  const favorites = createFavoritesCard();
  root.querySelector('[data-grid]')!.append(favorites.el, mine.el, reviews.el);

  const sso = root.querySelector<HTMLElement>('[data-sso]')!;
  const paintSso = () => { sso.innerHTML = renderSsoNotice(getSsoOrganizations()); };
  subscribeSso(paintSso);
  paintSso();

  return { root, cards: [favorites, mine, reviews], search, loadedAt: 0 };
}

function refreshAll(force = false): void {
  if (!dashboard) return;
  dashboard.loadedAt = Date.now();
  dashboard.cards.forEach((card) => void card.refresh(force));
}

/** (Re)attach the dashboard to GitHub's main container if a navigation removed it. */
function ensureMounted(): void {
  const main = document.querySelector<HTMLElement>('.application-main');
  if (!main || !dashboard || dashboard.root.parentElement === main) return;
  main.prepend(dashboard.root);
}

function onVisibility(): void {
  if (document.visibilityState === 'visible' && dashboard && Date.now() - dashboard.loadedAt > STALE_AFTER_MS) refreshAll();
}

function unmount(): void {
  document.documentElement.classList.remove(HOME_CLASS);
  observer?.disconnect();
  observer = null;
  document.removeEventListener('visibilitychange', onVisibility);
  dashboard?.root.remove();
  dashboard = null;
}

/** Show the dashboard on the GitHub home page; remove it (and restore GitHub's page) elsewhere. */
export function mountDashboard(enabled: boolean, organizations: string): void {
  if (!enabled) {
    if (dashboard) unmount();
    return;
  }
  organizationSetting = organizations;
  document.documentElement.classList.add(HOME_CLASS);
  if (!dashboard) {
    dashboard = build();
    observer = new MutationObserver(() => { if (!dashboard?.root.isConnected) ensureMounted(); });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', onVisibility);
    ensureMounted();
    refreshAll();
  } else {
    ensureMounted();
  }
}

/** The organization setting changed: re-detect organizations for the next search. */
export function updateDashboardOrganizations(organizations: string): void {
  organizationSetting = organizations;
  dashboard?.search.reset();
}
