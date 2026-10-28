import type { AnalyticsDayRow, AnalyticsHourRow, AnalyticsTopViewer, AnalyticsTotals } from '../../../../shared/messages.ts';
import type { AnalyticsMetric } from './analytics-metrics.ts';

export interface DaySummary {
  total: number;
  average: number;
  peakValue: number;
  peakDay: number | null;
  peakIndex: number;
}

export function summarizeDaySeries(
  days: readonly AnalyticsDayRow[],
  startDay: number,
  endDay: number,
  metric: AnalyticsMetric,
): DaySummary {
  const length = Math.max(0, endDay - startDay + 1);
  if (length === 0) return { total: 0, average: 0, peakValue: 0, peakDay: null, peakIndex: -1 };
  const byDay = new Map(days.map((row) => [row.day, Math.max(0, row[metric] ?? 0)]));
  let total = 0;
  let peakValue = 0;
  let peakIndex = -1;
  for (let index = 0; index < length; index += 1) {
    const value = byDay.get(startDay + index) ?? 0;
    total += value;
    if (value > peakValue || (peakIndex === -1 && value === 0)) {
      peakValue = value;
      peakIndex = index;
    }
  }
  if (peakIndex === -1) peakIndex = 0;
  return {
    total,
    average: length > 0 ? total / length : 0,
    peakValue,
    peakDay: peakIndex >= 0 ? startDay + peakIndex : null,
    peakIndex,
  };
}

export interface HourSummary {
  total: number;
  peakValue: number;
  peakHour: number | null;
}

export function summarizeHourlySeries(values: readonly number[]): HourSummary {
  let total = 0;
  let peakValue = 0;
  let peakHour: number | null = null;
  values.forEach((value, hour) => {
    const safe = Math.max(0, value ?? 0);
    total += safe;
    if (safe > peakValue) {
      peakValue = safe;
      peakHour = hour;
    }
  });
  return { total, peakValue, peakHour };
}

export interface MixSlice {
  metric: AnalyticsMetric;
  value: number;
  share: number;
}

const mixMetrics: readonly AnalyticsMetric[] = ['chats', 'gifts', 'likes', 'diamonds'];

export function engagementMix(totals: AnalyticsTotals): MixSlice[] {
  const sum = mixMetrics.reduce((acc, metric) => acc + Math.max(0, totals[metric] ?? 0), 0);
  return mixMetrics.map((metric) => {
    const value = Math.max(0, totals[metric] ?? 0);
    return { metric, value, share: sum > 0 ? value / sum : 0 };
  });
}

export function topFans(viewers: readonly AnalyticsTopViewer[], count = 3): AnalyticsTopViewer[] {
  return [...viewers].slice(0, Math.max(0, count));
}

export function activeShare(viewerInteractions: number, totalInteractions: number): number {
  if (!Number.isFinite(viewerInteractions) || !Number.isFinite(totalInteractions)) return 0;
  if (totalInteractions <= 0 || viewerInteractions <= 0) return 0;
  return Math.min(1, viewerInteractions / totalInteractions);
}

export function totalsInteractions(viewers: readonly AnalyticsTopViewer[]): number {
  return viewers.reduce((sum, viewer) => sum + Math.max(0, viewer.interactions ?? 0), 0);
}

export function hourTotals(hours: readonly AnalyticsHourRow[], metric: AnalyticsMetric): number[] {
  const out = new Array<number>(24).fill(0);
  for (const row of hours) {
    if (row.hour < 0 || row.hour >= 24) continue;
    out[row.hour] = Math.max(0, row[metric] ?? 0);
  }
  return out;
}
