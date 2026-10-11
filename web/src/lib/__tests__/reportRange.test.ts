import { describe, expect, it } from 'vitest';
import { parseYmd, rangeFor, resolveReportRange } from '../reportRange';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('rangeFor', () => {
  it('uses civil months, including January year-boundary windows', () => {
    const jan = new Date(2026, 0, 15);
    expect(ymd(rangeFor('month', jan).start)).toBe('2026-01-01');
    expect(ymd(rangeFor('month', jan).end)).toBe('2026-01-31');
    expect(ymd(rangeFor('last', jan).start)).toBe('2025-12-01');
    expect(ymd(rangeFor('last', jan).end)).toBe('2025-12-31');
    expect(ymd(rangeFor('3m', jan).start)).toBe('2025-11-01');
    expect(ymd(rangeFor('3m', jan).end)).toBe('2026-01-31');
    expect(ymd(rangeFor('ytd', jan).start)).toBe('2026-01-01');
    expect(ymd(rangeFor('12m', jan).start)).toBe('2025-02-01');
    expect(ymd(rangeFor('12m', jan).end)).toBe('2026-01-31');
  });

  it('ends this-month / ytd / 12m on the last day of the current month', () => {
    const feb = new Date(2026, 1, 10);
    expect(ymd(rangeFor('month', feb).end)).toBe('2026-02-28');
    expect(ymd(rangeFor('ytd', feb).end)).toBe('2026-02-28');
    expect(ymd(rangeFor('3m', feb).start)).toBe('2025-12-01');
  });
});

describe('resolveReportRange', () => {
  it('swaps a reversed custom range so start is never after end', () => {
    const r = resolveReportRange('custom', new Date(2026, 5, 1), '2026-06-30', '2026-06-01');
    expect(ymd(r.start)).toBe('2026-06-01');
    expect(ymd(r.end)).toBe('2026-06-30');
  });

  it('parses date-only strings as local civil days, not UTC midnight', () => {
    const d = parseYmd('2026-03-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(1);
  });
});
