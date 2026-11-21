/**
 * Helpers for GitHub's authenticated web endpoints. Everything is same-origin and rides on the
 * browser session, so no token is needed. GitHub's pages are React apps whose data is embedded as
 * JSON, which is far more stable than scraping markup.
 */
const JSON_HEADERS = {
  Accept: 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
  'GitHub-Verified-Fetch': 'true',
};

export class LoginRequiredError extends Error {
  constructor() {
    super('GitHub login is required');
  }
}

function assertOk(response: Response): void {
  if (new URL(response.url, location.origin).pathname === '/login') throw new LoginRequiredError();
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
}

/** Fetch a page and return the `payload` of its `react-app.embeddedData` script. */
export async function fetchEmbeddedPayload<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
  assertOk(response);
  const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
  const raw = doc.querySelector('script[data-target="react-app.embeddedData"]')?.textContent;
  if (!raw) throw new Error('Unexpected GitHub page format');
  return (JSON.parse(raw) as { payload: T }).payload;
}

/** Fetch one of the `page_data/*` JSON endpoints the PR page itself calls. */
export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', headers: JSON_HEADERS });
  assertOk(response);
  return (await response.json()) as T;
}

/** Link that lets the user authorize SAML SSO for an organization, then return to GitHub home. */
export const ssoAuthorizeUrl = (login: string): string =>
  `/orgs/${encodeURIComponent(login)}/sso?return_to=${encodeURIComponent('/')}`;
