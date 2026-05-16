/**
 * URL & page detection — extract owner/repo/run_id and detect the target page
 */
export interface RunParams {
  owner: string;
  repo: string;
  runId: string;
}

export function parseUrl(): RunParams | null {
  const urlMatch = location.pathname.match(
    /^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)/
  );
  if (!urlMatch) return null;
  const [, owner, repo, runId] = urlMatch;
  return { owner, repo, runId };
}

const DEPLOY_PRD_RE = /Deploy\s*\(\s*PRD\s*\)/i;

/** Detect whether the current page is a Deploy (PRD) workflow run page. */
export function isDeployPRDPage(): boolean {
  const labels = document.querySelectorAll<HTMLElement>(
    '.PageHeader-parentLink-label'
  );
  for (const lbl of labels) {
    if (DEPLOY_PRD_RE.test(lbl.textContent || '')) return true;
  }
  return false;
}

/** Get the workflow name from the page header, if available. */
export function getWorkflowName(): string {
  const lbl = document.querySelector<HTMLElement>(
    '.PageHeader-parentLink-label'
  );
  return lbl ? (lbl.textContent || '').trim() : '';
}
