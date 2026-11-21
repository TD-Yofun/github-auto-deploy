/**
 * Organizations whose SAML SSO this session has not authorized. GitHub hides their private
 * repositories and pull requests (results simply come back empty), so the dashboard tells the
 * user why instead of showing a misleading empty state.
 */
export interface SsoOrganization {
  login: string;
  name: string;
}

type Listener = (organizations: SsoOrganization[]) => void;

let current: SsoOrganization[] = [];
let known = false;
const listeners = new Set<Listener>();

export const getSsoOrganizations = (): SsoOrganization[] => current;

/** True once at least one GitHub response told us which organizations need SSO. */
export const isSsoKnown = (): boolean => known;

export function reportSsoOrganizations(organizations: SsoOrganization[]): void {
  const key = (list: SsoOrganization[]) => list.map((o) => o.login).sort().join(',');
  known = true;
  if (key(organizations) === key(current)) return;
  current = organizations;
  listeners.forEach((listener) => listener(current));
}

export function subscribeSso(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
