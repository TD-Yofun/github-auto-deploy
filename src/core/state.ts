/**
 * Runtime state for the monitoring session
 */
export interface SessionEvent {
  ts: number;
  type: string;
  detail: string;
  /** Environments approved by this event (approve events only). */
  environments?: string[];
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
  sessionEvents: SessionEvent[];
  /** Timestamp of last successful approve/skip; used by watchdog to auto-reload when stuck */
  lastProgressAt: number;
  /** Accumulated paused time (ms) and the start of the current pause (0 when not paused). */
  pausedMs: number;
  pausedAt: number;
  monitorEndedAt: number;
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
    sessionEvents: [],
    lastProgressAt: 0,
    pausedMs: 0,
    pausedAt: 0,
    monitorEndedAt: 0,
  };
}
