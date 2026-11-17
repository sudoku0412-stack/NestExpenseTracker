import { describe, expect, it } from 'vitest';
import { rangeFor, resolveReportRange } from '../reportRange';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('rangeFor', () => {
  it('this month runs from the 1st through the last day of the current month', () => {
    const r = rangeFor('month', new Date(2026, 2, 15));
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('last month crosses the year boundary and uses February length', () => {
    const r = rangeFor('last', new Date(2026, 0, 10));
    expect(ymd(r.start)).toBe('2025-12-01');
    expect(ymd(r.end)).toBe('2025-12-31');
    const feb = rangeFor('last', new Date(2024, 2, 1));
    expect(ymd(feb.start)).toBe('2024-02-01');
    expect(ymd(feb.end)).toBe('2024-02-29');
  });

  it('3m and 12m are inclusive of the current month', () => {
    const now = new Date(2026, 2, 15);
    const three = rangeFor('3m', now);
    expect(ymd(three.start)).toBe('2026-01-01');
    expect(ymd(three.end)).toBe('2026-03-31');
    const twelve = rangeFor('12m', now);
    expect(ymd(twelve.start)).toBe('2025-04-01');
    expect(ymd(twelve.end)).toBe('2026-03-31');
  });

  it('year to date starts January 1', () => {
    const r = rangeFor('ytd', new Date(2026, 10, 17));
    expect(ymd(r.start)).toBe('2026-01-01');
    expect(ymd(r.end)).toBe('2026-11-30');
  });
});

describe('resolveReportRange', () => {
  it('swaps a custom range that was typed backwards', () => {
    const r = resolveReportRange('custom', new Date(), '2026-03-20', '2026-03-01');
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-20');
  });

  it('keeps a custom range that is already in order', () => {
    const r = resolveReportRange('custom', new Date(), '2026-01-01', '2026-01-31');
    expect(ymd(r.start)).toBe('2026-01-01');
    expect(ymd(r.end)).toBe('2026-01-31');
  });
});
