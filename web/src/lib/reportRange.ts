export type ReportPreset = 'month' | 'last' | '3m' | 'ytd' | '12m' | 'custom';

export const REPORT_PRESETS: { id: ReportPreset; label: string }[] = [
  { id: 'month', label: 'This month' }, { id: 'last', label: 'Last month' }, { id: '3m', label: 'Last 3 months' },
  { id: 'ytd', label: 'Year to date' }, { id: '12m', label: 'Last 12 months' }, { id: 'custom', label: 'Custom' },
];

export const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Inclusive local-calendar range for a Reports preset. `custom` falls through to this month; callers swap that out. */
export function rangeFor(preset: ReportPreset, now: Date): { start: Date; end: Date } {
  const y = now.getFullYear(), m = now.getMonth();
  switch (preset) {
    case 'last': return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0) };
    case '3m': return { start: new Date(y, m - 2, 1), end: new Date(y, m + 1, 0) };
    case 'ytd': return { start: new Date(y, 0, 1), end: new Date(y, m + 1, 0) };
    case '12m': return { start: new Date(y, m - 11, 1), end: new Date(y, m + 1, 0) };
    default: return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0) };
  }
}

export function resolveReportRange(preset: ReportPreset, from: string, to: string, now: Date): { start: Date; end: Date } {
  if (preset === 'custom') {
    const s = parseYmd(from), e = parseYmd(to);
    return s <= e ? { start: s, end: e } : { start: e, end: s };
  }
  return rangeFor(preset, now);
}
