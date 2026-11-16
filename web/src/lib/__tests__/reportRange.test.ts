import { describe, expect, it } from 'vitest';
import { orderedYmdRange, rangeFor } from '../reportRange';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('rangeFor', () => {
  const now = new Date(2026, 2, 15); // 15 Mar 2026 local

  it('this month is the 1st through the last calendar day', () => {
    const r = rangeFor('month', now);
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('last month crosses a year boundary in January', () => {
    const r = rangeFor('last', new Date(2026, 0, 10));
    expect(ymd(r.start)).toBe('2025-12-01');
    expect(ymd(r.end)).toBe('2025-12-31');
  });

  it('last 3 months and YTD and 12 months are inclusive through month-end', () => {
    expect(ymd(rangeFor('3m', now).start)).toBe('2026-01-01');
    expect(ymd(rangeFor('3m', now).end)).toBe('2026-03-31');
    expect(ymd(rangeFor('ytd', now).start)).toBe('2026-01-01');
    expect(ymd(rangeFor('12m', now).start)).toBe('2025-04-01');
    expect(ymd(rangeFor('12m', now).end)).toBe('2026-03-31');
  });
});

describe('orderedYmdRange', () => {
  it('swaps backwards custom dates so start is never after end', () => {
    const r = orderedYmdRange('2026-04-10', '2026-03-01');
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-04-10');
  });
});
