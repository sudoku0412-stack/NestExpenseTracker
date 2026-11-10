import { describe, expect, it } from 'vitest';
import { parseYmd, rangeFor, reportRange } from '../reportRange';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('rangeFor', () => {
  it('this month runs from the 1st through the last local day', () => {
    const r = rangeFor('month', new Date(2026, 1, 10));
    expect(ymd(r.start)).toBe('2026-02-01');
    expect(ymd(r.end)).toBe('2026-02-28');
  });

  it('last month crosses the year boundary', () => {
    const r = rangeFor('last', new Date(2026, 0, 15));
    expect(ymd(r.start)).toBe('2025-12-01');
    expect(ymd(r.end)).toBe('2025-12-31');
  });

  it('last 3 months includes the current month and two prior', () => {
    const r = rangeFor('3m', new Date(2026, 0, 20));
    expect(ymd(r.start)).toBe('2025-11-01');
    expect(ymd(r.end)).toBe('2026-01-31');
  });

  it('year to date starts Jan 1 and last 12 months starts 11 months back', () => {
    const now = new Date(2026, 2, 5);
    const ytd = rangeFor('ytd', now);
    expect(ymd(ytd.start)).toBe('2026-01-01');
    expect(ymd(ytd.end)).toBe('2026-03-31');
    const twelve = rangeFor('12m', now);
    expect(ymd(twelve.start)).toBe('2025-04-01');
    expect(ymd(twelve.end)).toBe('2026-03-31');
  });
});

describe('reportRange', () => {
  it('parses YYYY-MM-DD as a local calendar day', () => {
    const d = parseYmd('2026-03-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(1);
  });

  it('swaps an inverted custom from/to so the window is never empty', () => {
    const r = reportRange('custom', new Date(2026, 5, 1), '2026-06-30', '2026-06-01');
    expect(ymd(r.start)).toBe('2026-06-01');
    expect(ymd(r.end)).toBe('2026-06-30');
  });
});
