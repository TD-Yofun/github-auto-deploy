/** Repository search inside organizations, read from the embedded JSON of GitHub's search page. */
import { fetchEmbeddedPayload } from './github';
import { fetchPullRequests } from './pull-requests';
import { getSsoOrganizations, isSsoKnown } from './sso';

export interface RepositoryHit {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  /** `hl_name` / description with GitHub's <em> match markers, still unescaped. */
  nameMarked: string;
  descriptionMarked: string;
  language: string;
  archived: boolean;
  isPublic: boolean;
}

export interface RepositorySearchResult {
  hits: RepositoryHit[];
  /** Organizations in the query that require SSO this session has not authorized. */
  ssoBlocked: string[];
}

interface SearchPayload {
  blackbirdSearchRoute: {
    results: {
      hl_name?: string;
      hl_trunc_description?: string;
      language?: string;
      archived?: boolean;
      public?: boolean;
      repo?: { repository?: { name: string; owner_login: string } };
    }[];
    protected_org_logins?: string[];
  };
}

export async function searchRepositories(organizations: string[], keyword: string): Promise<RepositorySearchResult> {
  const scope = organizations.map((org) => `org:${org}`).join(' ');
  const query = `${scope} ${keyword.trim()}`.trim();
  const payload = await fetchEmbeddedPayload<SearchPayload>(`/search?q=${encodeURIComponent(query)}&type=repositories`);
  const route = payload.blackbirdSearchRoute;

  const hits = route.results.flatMap((r): RepositoryHit[] => {
    const repository = r.repo?.repository;
    if (!repository) return [];
    const fullName = `${repository.owner_login}/${repository.name}`;
    return [{
      owner: repository.owner_login,
      name: repository.name,
      fullName,
      url: `https://github.com/${fullName}`,
      nameMarked: r.hl_name || fullName,
      descriptionMarked: r.hl_trunc_description || '',
      language: r.language || '',
      archived: !!r.archived,
      isPublic: r.public !== false,
    }];
  });

  // An empty result only means "SSO needed" for an SSO-protected org this session has not
  // authorized. Protected orgs are listed even for authorized sessions, so confirm against the
  // authoritative list that the pull request pages report.
  let ssoBlocked: string[] = [];
  if (hits.length === 0 && (route.protected_org_logins?.length ?? 0) > 0) {
    if (!isSsoKnown()) await fetchPullRequests('authored').catch(() => undefined);
    const unauthorized = new Set(getSsoOrganizations().map((o) => o.login.toLowerCase()));
    ssoBlocked = organizations.filter((o) => unauthorized.has(o.toLowerCase()));
  }
  return { hits, ssoBlocked };
}
