/**
 * Runtime state for the monitoring session
 */
export interface SessionEvent {
  ts: number;
  type: string;
  detail: string;
}

export interface State {
  running: boolean;
  paused: boolean;
  pollTimer: ReturnType<typeof setTimeout> | null;
  /** runId captured when start() was called — guards against URL drift */
  startRunId: string | null;
  sessionApproved: number;
  totalApproved: number;
  lastSkipKey: string;
  monitorStartedAt: number;
  pollCycle: number;
  sessionSkipped: number;
  sessionEvents: SessionEvent[];
  /** Timestamp of last successful approve/skip; used by watchdog to auto-reload when stuck */
  lastProgressAt: number;
}

export const GRACE_PERIOD = 90; // seconds to wait for re-run to propagate
export const WATCHDOG_TIMEOUT_MS = 10 * 60 * 1000; // 10min no progress → reload page

export function createState(): State {
  return {
    running: false,
    paused: false,
    pollTimer: null,
    startRunId: null,
    sessionApproved: 0,
    totalApproved: 0,
    lastSkipKey: '',
    monitorStartedAt: 0,
    pollCycle: 0,
    sessionSkipped: 0,
    sessionEvents: [],
    lastProgressAt: 0,
  };
}
