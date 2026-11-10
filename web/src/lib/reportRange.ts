export type ReportPreset = 'month' | 'last' | '3m' | 'ytd' | '12m' | 'custom';

export const REPORT_PRESETS: { id: ReportPreset; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: 'last', label: 'Last month' },
  { id: '3m', label: 'Last 3 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'custom', label: 'Custom' },
];

/** Local calendar date from a YYYY-MM-DD string (not UTC midnight). */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Inclusive start/end for a named Reports preset. `now` is wall-clock local. */
export function rangeFor(preset: Exclude<ReportPreset, 'custom'>, now: Date): { start: Date; end: Date } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'last':
      return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0) };
    case '3m':
      return { start: new Date(y, m - 2, 1), end: new Date(y, m + 1, 0) };
    case 'ytd':
      return { start: new Date(y, 0, 1), end: new Date(y, m + 1, 0) };
    case '12m':
      return { start: new Date(y, m - 11, 1), end: new Date(y, m + 1, 0) };
    default:
      return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0) };
  }
}

/** Custom ranges swap inverted from/to so CSV and KPIs still cover the same days. */
export function reportRange(
  preset: ReportPreset,
  now: Date,
  from?: string,
  to?: string,
): { start: Date; end: Date } {
  if (preset === 'custom' && from && to) {
    const s = parseYmd(from);
    const e = parseYmd(to);
    return s <= e ? { start: s, end: e } : { start: e, end: s };
  }
  return rangeFor(preset === 'custom' ? 'month' : preset, now);
}
