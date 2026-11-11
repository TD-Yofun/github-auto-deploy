/**
 * Storage hygiene — per-run keys (log, session, running flag, report) are keyed by runId and
 * would otherwise accumulate in Tampermonkey storage forever. A small index records when each
 * run was last touched; runs idle for longer than RETENTION_MS are deleted on startup.
 */
const INDEX_KEY = 'aad_run_index';
const RUN_KEY_PREFIXES = ['aad_log_', 'aad_session_', 'aad_running_', 'aad_report_'] as const;
export const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

type RunIndex = Record<string, number>;

function readIndex(): RunIndex {
  const raw = GM_getValue<RunIndex | null>(INDEX_KEY, null);
  return raw && typeof raw === 'object' ? { ...raw } : {};
}

/** Record activity for a run so it is kept for another RETENTION_MS. */
export function touchRun(runId: string, now = Date.now()): void {
  const index = readIndex();
  index[runId] = now;
  GM_setValue(INDEX_KEY, index);
}

/**
 * Delete data of runs idle for longer than RETENTION_MS. Runs that predate the index are adopted
 * with `now` as their timestamp, so legacy data is cleaned 14 days after the first run of this
 * version instead of being deleted blindly. Returns the number of runs removed.
 */
export function pruneStaleRuns(now = Date.now()): number {
  const index = readIndex();
  const keys = GM_listValues();

  const stored = new Set<string>();
  for (const key of keys) {
    const prefix = RUN_KEY_PREFIXES.find((p) => key.startsWith(p));
    if (prefix) stored.add(key.slice(prefix.length));
  }

  let changed = false;
  for (const runId of stored) {
    if (index[runId] === undefined) {
      index[runId] = now;
      changed = true;
    }
  }
  // Drop index entries whose data is already gone.
  for (const runId of Object.keys(index)) {
    if (!stored.has(runId)) {
      delete index[runId];
      changed = true;
    }
  }

  let removed = 0;
  for (const runId of stored) {
    if (now - index[runId] <= RETENTION_MS) continue;
    for (const prefix of RUN_KEY_PREFIXES) GM_deleteValue(`${prefix}${runId}`);
    delete index[runId];
    removed++;
    changed = true;
  }

  if (changed) GM_setValue(INDEX_KEY, index);
  return removed;
}
