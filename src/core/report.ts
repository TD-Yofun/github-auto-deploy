/**
 * Execution report — one data model rendered both in the panel and as Markdown.
 */
import { formatDuration } from '../utils/helpers';
import type { SessionEvent, State } from './state';

export interface ReportInfo {
  owner?: string;
  repo?: string;
  runId?: string;
  workflow?: string;
}

export interface Report extends ReportInfo {
  conclusion: string;
  startedAt: number;
  endedAt: number;
  /** Monitoring time excluding pauses (ms). This is not the workflow's own run time. */
  activeMs: number;
  pausedMs: number;
  approvals: number;
  /** Unique environment names across all approvals, in approval order. */
  environments: string[];
  events: SessionEvent[];
}

const EVENT_ICONS: Record<string, string> = {
  approve: '✅',
  error: '❌',
  start: '🚀',
  resume: '🔄',
  complete: '🏁',
};

export const eventIcon = (type: string): string => EVENT_ICONS[type] || '📌';

export const clockTime = (ms: number): string =>
  new Date(ms).toLocaleTimeString('en-US', { hour12: false });

export function buildReport(state: State, conclusion: string, info?: ReportInfo): Report {
  const endedAt = state.monitorEndedAt || Date.now();
  const pausedMs = state.pausedMs + (state.pausedAt ? endedAt - state.pausedAt : 0);
  const approvals = state.sessionEvents.filter((e) => e.type === 'approve');
  const environments = [...new Set(approvals.flatMap((e) => e.environments || []))];
  return {
    ...info,
    conclusion: conclusion || 'unknown',
    startedAt: state.monitorStartedAt,
    endedAt,
    activeMs: Math.max(0, endedAt - state.monitorStartedAt - pausedMs),
    pausedMs,
    approvals: approvals.length,
    environments,
    events: state.sessionEvents,
  };
}

export function reportToMarkdown(r: Report): string {
  const head = r.workflow ? `## 📊 ${r.workflow} — Run #${r.runId || ''}` : '## 📊 执行报告';
  const where: string[] = [];
  if (r.owner && r.repo) {
    where.push(`**Repository:** ${r.owner}/${r.repo}`);
    if (r.runId) where.push(`**Run:** [#${r.runId}](https://github.com/${r.owner}/${r.repo}/actions/runs/${r.runId})`);
  }
  const lines = [
    head,
    '',
    ...(where.length ? [where.join('  \n'), ''] : []),
    `- **结果:** ${r.conclusion}`,
    `- **监控时长:** ${formatDuration(r.activeMs)}`,
    ...(r.pausedMs > 0 ? [`- **暂停时长:** ${formatDuration(r.pausedMs)}`] : []),
    `- **审批次数:** ${r.approvals}`,
    ...(r.environments.length ? [`- **审批环境:** ${r.environments.join(', ')}`] : []),
    `- **开始时间:** ${new Date(r.startedAt).toLocaleString()}`,
    `- **结束时间:** ${new Date(r.endedAt).toLocaleString()}`,
  ];
  if (r.events.length > 0) {
    lines.push('', '### 📋 执行时间线', '');
    r.events.forEach((ev) => lines.push(`- \`${clockTime(ev.ts)}\` ${eventIcon(ev.type)} ${ev.detail}`));
  }
  return lines.join('\n') + '\n';
}
