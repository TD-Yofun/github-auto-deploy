/**
 * Version check — fetch latest release tag from GitHub and compare.
 * Caches result for 1 hour to avoid hitting the anonymous API rate limit.
 */
const REPO = 'TD-Yofun/talkdesk-auto-deploy';
const CACHE_KEY = 'aad_version_cache';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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
  if (cached) {
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
      url: `https://api.github.com/repos/${REPO}/releases/latest`,
      headers: { Accept: 'application/vnd.github+json' },
      onload(r) {
        if (r.status >= 200 && r.status < 300) {
          try {
            const data = JSON.parse(r.responseText);
            const latest = String(data.tag_name || '').replace(/^v/, '');
            const releaseUrl = data.html_url || `https://github.com/${REPO}/releases/latest`;
            const releaseNotes = String(data.body || '').trim();
            writeCache({ latest, releaseUrl, releaseNotes, ts: Date.now() });
            resolve({
              current,
              latest,
              outdated: isNewer(latest, current),
              releaseUrl,
              releaseNotes,
            });
          } catch {
            reject(new Error('Failed to parse latest release'));
          }
        } else if (r.status === 404) {
          // No releases yet — treat as up-to-date
          resolve({ current, latest: current, outdated: false, releaseUrl: `https://github.com/${REPO}/releases`, releaseNotes: '' });
        } else {
          reject(new Error(`HTTP ${r.status}`));
        }
      },
      onerror() {
        reject(new Error('Network error'));
      },
    });
  });
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
