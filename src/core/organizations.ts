/** Which organizations repository search should cover. */
import { fetchPullRequests } from './pull-requests';
import { getSsoOrganizations } from './sso';

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

export const parseOrganizations = (value: string): string[] =>
  [...new Set(value.split(/[\s,]+/).filter((login) => LOGIN_RE.test(login)))];

/** `/orgs/<login>…` links inside a piece of the account switcher. */
function organizationsFromLinks(root: ParentNode): string[] {
  const logins = new Map<string, string>();
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href^="/orgs/"]')) {
    const match = new URL(link.href, location.origin).pathname.match(/^\/orgs\/([^/]+)/i);
    if (match) logins.set(match[1].toLowerCase(), decodeURIComponent(match[1]));
  }
  return [...logins.values()];
}

/**
 * Organizations GitHub embeds in the home page for its Copilot prompt. Present on page load with
 * or without SSO, so it does not depend on any lazily loaded fragment.
 */
function organizationsFromEmbeddedData(): string[] {
  const script = document.querySelector('react-partial[partial-name="copilot-chat-input-partial"] script[data-target="react-partial.embeddedData"]');
  try {
    const props = JSON.parse(script?.textContent ?? '{}').props ?? {};
    const entries: { login?: string }[] = [...(props.userOrganizations ?? []), ...(props.ssoOrganizations ?? [])];
    return [...new Set(entries.map((e) => e.login).filter((l): l is string => !!l && LOGIN_RE.test(l)))];
  } catch {
    return [];
  }
}

/**
 * The account switcher. Its list is a lazily loaded fragment that is empty until the dialog is
 * opened (once SSO is authorized), so fall back to fetching that fragment ourselves.
 */
async function organizationsFromSwitcher(): Promise<string[]> {
  const dialogs = document.querySelectorAll<HTMLElement>('dialog[id^="switch_dashboard_context"]');
  for (const dialog of dialogs) {
    const found = organizationsFromLinks(dialog);
    if (found.length > 0) return found;
  }
  const src = document.querySelector('dialog[id^="switch_dashboard_context"] include-fragment[src]')?.getAttribute('src');
  if (!src) return [];
  try {
    const response = await fetch(src, { credentials: 'same-origin', headers: { Accept: 'text/html', 'X-Requested-With': 'XMLHttpRequest' } });
    return response.ok ? organizationsFromLinks(new DOMParser().parseFromString(await response.text(), 'text/html')) : [];
  } catch {
    return [];
  }
}

let cached: { key: string; value: Promise<string[]> } | null = null;

export function resetOrganizationCache(): void {
  cached = null;
}

/** Explicit setting wins, then GitHub's embedded list, the account switcher, and orgs awaiting SSO. */
export function getOrganizations(override: string): Promise<string[]> {
  if (cached && cached.key === override) return cached.value;
  const value = (async () => {
    const configured = parseOrganizations(override);
    if (configured.length > 0) return configured;
    const embedded = organizationsFromEmbeddedData();
    if (embedded.length > 0) return embedded;
    const switcher = await organizationsFromSwitcher();
    if (switcher.length > 0) return switcher;
    if (getSsoOrganizations().length === 0) await fetchPullRequests('authored').catch(() => undefined);
    return getSsoOrganizations().map((o) => o.login);
  })();
  const entry = { key: override, value };
  cached = entry;
  // An empty answer usually means "not ready yet": do not let it stick.
  void value.then((list) => { if (list.length === 0 && cached === entry) cached = null; });
  return value;
}
