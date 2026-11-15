import { describe, expect, it } from 'vitest';
import { parseYmd, rangeFor, resolveReportRange } from '../reportRange';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('rangeFor', () => {
  const now = new Date(2026, 2, 15); // 15 Mar 2026
  it('this month is the first through last day of March', () => {
    const r = rangeFor('month', now);
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });
  it('last month is February of a non-leap year', () => {
    const r = rangeFor('last', now);
    expect(ymd(r.start)).toBe('2026-02-01');
    expect(ymd(r.end)).toBe('2026-02-28');
  });
  it('3m starts at the first of the month two months ago', () => {
    const r = rangeFor('3m', now);
    expect(ymd(r.start)).toBe('2026-01-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });
  it('ytd starts 1 Jan and 12m starts 1 Apr of the previous year', () => {
    expect(ymd(rangeFor('ytd', now).start)).toBe('2026-01-01');
    expect(ymd(rangeFor('12m', now).start)).toBe('2025-04-01');
  });
});

describe('resolveReportRange', () => {
  it('swaps inverted custom endpoints', () => {
    const r = resolveReportRange('custom', new Date(), '2026-03-10', '2026-03-01');
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-10');
  });
  it('parseYmd uses local civil dates, not UTC midnight', () => {
    const d = parseYmd('2026-03-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(1);
  });
});
