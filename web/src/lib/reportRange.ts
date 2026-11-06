export type ReportPreset = 'month' | 'last' | '3m' | 'ytd' | '12m' | 'custom';

export const parseYmd = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Inclusive civil-day range for a reports preset. `custom` is this month; the
 *  page swaps in the typed dates instead. */
export function rangeFor(preset: ReportPreset, now: Date): { start: Date; end: Date } {
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

export function orderedRange(from: string, to: string): { start: Date; end: Date } {
  const s = parseYmd(from);
  const e = parseYmd(to);
  return s <= e ? { start: s, end: e } : { start: e, end: s };
}
