/**
 * Background-tab-resistant scheduler.
 *
 * Browsers throttle setTimeout in background tabs to ≥1 min.
 * Dedicated Web Workers are NOT throttled, so we delegate the timer there.
 *
 * Strategy: schedule BOTH a Worker tick and a setTimeout fallback in parallel
 * and fire whichever arrives first. This makes us robust to:
 *   - Hostile CSP (worker-src) that lets `new Worker(blob:)` succeed but
 *     silently swallows its messages — setTimeout still fires.
 *   - Background tab throttling that delays setTimeout — Worker still fires
 *     on time.
 * Once one fires, the other is cancelled to avoid double-firing.
 */

let worker: Worker | null = null;
let workerBroken = false;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
let currentToken = 0;

function createWorker(): Worker | null {
  try {
    const src = `let t=null;self.onmessage=(e)=>{const d=e.data;if(d&&d.type==='start'){if(t)clearTimeout(t);t=setTimeout(()=>self.postMessage('tick'),d.ms);}else if(d&&d.type==='stop'){if(t)clearTimeout(t);t=null;}};`;
    const blob = new Blob([src], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    return w;
  } catch {
    return null;
  }
}

/** Schedule `cb` to run once after `ms` milliseconds. Cancels any pending tick. */
export function scheduleTick(cb: () => void, ms: number): void {
  // Bump token to invalidate any in-flight callbacks from a previous schedule.
  const token = ++currentToken;

  // Cancel any pending fallback timer so we don't accumulate.
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
  if (worker) {
    worker.postMessage({ type: 'stop' });
  } else if (!workerBroken) {
    worker = createWorker();
    if (!worker) workerBroken = true;
  }

  const fire = () => {
    if (token !== currentToken) return; // stale
    currentToken++; // invalidate sibling
    if (fallbackTimer) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (worker) worker.postMessage({ type: 'stop' });
    cb();
  };

  if (worker) {
    worker.onmessage = () => fire();
    worker.postMessage({ type: 'start', ms });
  }
  // Always schedule a setTimeout fallback too — fires if the Worker is silently
  // broken (e.g., CSP-swallowed) and acts as the primary timer when no Worker.
  fallbackTimer = setTimeout(fire, ms);
}

export function cancelTick(): void {
  currentToken++; // invalidate any pending fire()
  if (worker) worker.postMessage({ type: 'stop' });
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
}

export function isWorkerScheduler(): boolean {
  return worker !== null && !workerBroken;
}
