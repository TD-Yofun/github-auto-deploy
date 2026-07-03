/**
 * Version check — fetch the public userscript release asset and compare the
 * @version metadata. Avoids GitHub's anonymous REST API rate limit.
 */
const REPO = 'TD-Yofun/github-auto-deploy';
const LATEST_SCRIPT_URL = `https://github.com/${REPO}/releases/latest/download/auto-approve-deploy.min.user.js`;
const CACHE_KEY = 'aad_version_cache';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min — short enough to surface new releases promptly

export interface VersionCheckResult {
  current: string;
  latest: string;
  outdated: boolean;
  releaseUrl: string;
  releaseNotes: string;
}

interface CachedVersion {
  latest: string;
  releaseUrl: string;
  releaseNotes: string;
  ts: number;
}

export function getCurrentVersion(): string {
  try {
    return GM_info?.script?.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export async function checkLatestVersion(current: string): Promise<VersionCheckResult> {
  const cached = readCache();
  // Use cache only if cached.latest is still >= current. If the installed script
  // is newer than what we last saw as "latest", the cache is definitely stale
  // (user just updated) — refetch so we surface the next release promptly.
  if (cached && !isNewer(current, cached.latest)) {
    return {
      current,
      latest: cached.latest,
      outdated: isNewer(cached.latest, current),
      releaseUrl: cached.releaseUrl,
      releaseNotes: cached.releaseNotes,
    };
  }

  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'GET',
      url: LATEST_SCRIPT_URL,
      onload(r) {
        if (r.status >= 200 && r.status < 300) {
          const latest = parseUserscriptVersion(r.responseText);
          if (!latest) {
            reject(new Error('Failed to parse latest userscript version'));
            return;
          }
          const releaseUrl = `https://github.com/${REPO}/releases/latest`;
          const releaseNotes = '';
          writeCache({ latest, releaseUrl, releaseNotes, ts: Date.now() });
          resolve({
            current,
            latest,
            outdated: isNewer(latest, current),
            releaseUrl,
            releaseNotes,
          });
          return;
        }
        reject(new Error(`HTTP ${r.status}`));
      },
      onerror() {
        reject(new Error('Network error'));
      },
    });
  });
}

function parseUserscriptVersion(source: string): string {
  const match = source.match(/^\s*\/\/\s*@version\s+([^\s]+)/m);
  return match ? match[1].replace(/^v/, '') : '';
}

function readCache(): CachedVersion | null {
  try {
    const raw = GM_getValue(CACHE_KEY, '');
    if (!raw) return null;
    const data = JSON.parse(raw) as CachedVersion;
    if (Date.now() - data.ts > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(data: CachedVersion): void {
  try {
    GM_setValue(CACHE_KEY, JSON.stringify(data));
  } catch {
    /* non-critical */
  }
}

/** Returns true if `a` is strictly newer than `b` (semver-like). */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}
