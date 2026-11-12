import { describe, expect, it } from 'vitest';
import { rangeFor, resolveRange } from '../reportRange';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('rangeFor', () => {
  const now = new Date(2026, 2, 15); // 15 Mar 2026, local

  it('this month is the first through last civil day', () => {
    const r = rangeFor('month', now);
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('last month crosses a year boundary', () => {
    const r = rangeFor('last', new Date(2026, 0, 10));
    expect(ymd(r.start)).toBe('2025-12-01');
    expect(ymd(r.end)).toBe('2025-12-31');
  });

  it('last 3 months and YTD and 12 months end on the current month last day', () => {
    expect(ymd(rangeFor('3m', now).start)).toBe('2026-01-01');
    expect(ymd(rangeFor('ytd', now).start)).toBe('2026-01-01');
    expect(ymd(rangeFor('12m', now).start)).toBe('2025-04-01');
    expect(ymd(rangeFor('12m', now).end)).toBe('2026-03-31');
  });
});

describe('resolveRange custom', () => {
  it('swaps inverted custom dates so start is always first', () => {
    const r = resolveRange('custom', new Date(), '2026-04-10', '2026-04-01');
    expect(ymd(r.start)).toBe('2026-04-01');
    expect(ymd(r.end)).toBe('2026-04-10');
  });
});
