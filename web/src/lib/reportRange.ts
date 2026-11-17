export type ReportPreset = 'month' | 'last' | '3m' | 'ytd' | '12m' | 'custom';

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

export const parseYmd = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Custom ranges swap inverted dates so the filter never runs with end < start. */
export function resolveReportRange(
  preset: ReportPreset,
  now: Date,
  fromYmd?: string,
  toYmd?: string,
): { start: Date; end: Date } {
  if (preset === 'custom' && fromYmd && toYmd) {
    const s = parseYmd(fromYmd), e = parseYmd(toYmd);
    return s <= e ? { start: s, end: e } : { start: e, end: s };
  }
  return rangeFor(preset, now);
}
