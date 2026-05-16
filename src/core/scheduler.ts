/**
 * Background-tab-resistant scheduler.
 *
 * Browsers throttle setTimeout in background tabs to ≥1 min.
 * Dedicated Web Workers are NOT throttled, so we delegate the timer there.
 *
 * Falls back to setTimeout if Worker / Blob URL is unavailable.
 */

let worker: Worker | null = null;
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
let currentCb: (() => void) | null = null;

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
  currentCb = cb;
  if (!worker) worker = createWorker();
  if (worker) {
    worker.onmessage = () => {
      if (currentCb) currentCb();
    };
    worker.postMessage({ type: 'start', ms });
  } else {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      if (currentCb) currentCb();
    }, ms);
  }
}

export function cancelTick(): void {
  currentCb = null;
  if (worker) worker.postMessage({ type: 'stop' });
  if (fallbackTimer) {
    clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }
}

export function isWorkerScheduler(): boolean {
  return worker !== null;
}
