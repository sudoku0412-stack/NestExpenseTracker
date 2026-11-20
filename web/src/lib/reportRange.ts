export type ReportPreset = 'month' | 'last' | '3m' | 'ytd' | '12m' | 'custom';

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Inclusive calendar range for a reports preset. `custom` is this month until the caller overrides. */
export function rangeFor(preset: ReportPreset, now: Date): { start: Date; end: Date } {
  const y = now.getFullYear(),
    m = now.getMonth();
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

export function customRange(from: string, to: string): { start: Date; end: Date } {
  const s = parseYmd(from),
    e = parseYmd(to);
  return s <= e ? { start: s, end: e } : { start: e, end: s };
}
