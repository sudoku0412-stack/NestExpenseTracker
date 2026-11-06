import { describe, expect, it } from 'vitest';
import { orderedRange, parseYmd, rangeFor } from '../reportRange';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('rangeFor', () => {
  const now = new Date(2026, 2, 15); // 15 Mar 2026 local

  it('this month is the first through last civil day', () => {
    const r = rangeFor('month', now);
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('last month ends on the final day of the previous month', () => {
    const r = rangeFor('last', now);
    expect(ymd(r.start)).toBe('2026-02-01');
    expect(ymd(r.end)).toBe('2026-02-28');
  });

  it('last 3 months starts two calendar months back and includes today\'s month', () => {
    const r = rangeFor('3m', now);
    expect(ymd(r.start)).toBe('2026-01-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('year to date starts 1 Jan', () => {
    const r = rangeFor('ytd', now);
    expect(ymd(r.start)).toBe('2026-01-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('last 12 months crosses the year boundary', () => {
    const r = rangeFor('12m', now);
    expect(ymd(r.start)).toBe('2025-04-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('January last-month wraps to December of the previous year', () => {
    const r = rangeFor('last', new Date(2026, 0, 10));
    expect(ymd(r.start)).toBe('2025-12-01');
    expect(ymd(r.end)).toBe('2025-12-31');
  });
});

describe('orderedRange', () => {
  it('parses a Y-M-D string as a local civil day', () => {
    const d = parseYmd('2026-03-05');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(5);
  });

  it('swaps inverted custom dates so start is never after end', () => {
    const r = orderedRange('2026-04-10', '2026-04-01');
    expect(ymd(r.start)).toBe('2026-04-01');
    expect(ymd(r.end)).toBe('2026-04-10');
  });
});
