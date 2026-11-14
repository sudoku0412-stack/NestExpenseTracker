import { describe, expect, it } from 'vitest';
import { rangeFor, resolveReportRange } from '../reportRange';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('rangeFor', () => {
  const now = new Date(2026, 2, 15); // 15 Mar 2026, local

  it('this month is the 1st through month-end', () => {
    const r = rangeFor('month', now);
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('last month is the previous calendar month, including a Feb in a non-leap year', () => {
    const r = rangeFor('last', now);
    expect(ymd(r.start)).toBe('2026-02-01');
    expect(ymd(r.end)).toBe('2026-02-28');
  });

  it('3m starts two months back and ytd starts Jan 1', () => {
    expect(ymd(rangeFor('3m', now).start)).toBe('2026-01-01');
    expect(ymd(rangeFor('ytd', now).start)).toBe('2026-01-01');
    expect(ymd(rangeFor('12m', now).start)).toBe('2025-04-01');
    expect(ymd(rangeFor('12m', now).end)).toBe('2026-03-31');
  });
});

describe('resolveReportRange', () => {
  it('swaps inverted custom dates so the query still covers the interval', () => {
    const r = resolveReportRange('custom', new Date(), '2026-03-20', '2026-03-01');
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-20');
  });
});
