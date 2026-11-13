import { describe, expect, it } from 'vitest';
import { customRange, parseYmd, rangeFor } from '../reportRange';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('rangeFor', () => {
  const now = new Date(2026, 2, 15); // 15 Mar 2026 local

  it('this month is the 1st through the last day of the current month', () => {
    const r = rangeFor('month', now);
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('last month ends on the last day of the previous month, including February', () => {
    const r = rangeFor('last', now);
    expect(ymd(r.start)).toBe('2026-02-01');
    expect(ymd(r.end)).toBe('2026-02-28');
  });

  it('last 3 months starts two months back and ends this month', () => {
    const r = rangeFor('3m', now);
    expect(ymd(r.start)).toBe('2026-01-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('year to date starts Jan 1', () => {
    const r = rangeFor('ytd', now);
    expect(ymd(r.start)).toBe('2026-01-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('last 12 months crosses the year boundary', () => {
    const r = rangeFor('12m', now);
    expect(ymd(r.start)).toBe('2025-04-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('January last-month range lands in December of the previous year', () => {
    const r = rangeFor('last', new Date(2026, 0, 4));
    expect(ymd(r.start)).toBe('2025-12-01');
    expect(ymd(r.end)).toBe('2025-12-31');
  });
});

describe('customRange', () => {
  it('parses civil dates as local midnight, not UTC', () => {
    expect(parseYmd('2026-03-05').getDate()).toBe(5);
    expect(parseYmd('2026-03-05').getMonth()).toBe(2);
  });

  it('swaps inverted from/to so the filter still includes the days', () => {
    const r = customRange('2026-03-10', '2026-03-01');
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-10');
  });
});
