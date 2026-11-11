import { describe, expect, it } from 'vitest';
import { rangeFor, resolveReportRange } from '../reportRange';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('rangeFor', () => {
  it('uses the current civil month, including the last day', () => {
    const { start, end } = rangeFor('month', new Date(2026, 2, 15));
    expect(ymd(start)).toBe('2026-03-01');
    expect(ymd(end)).toBe('2026-03-31');
  });

  it('last month crosses a year boundary', () => {
    const { start, end } = rangeFor('last', new Date(2026, 0, 10));
    expect(ymd(start)).toBe('2025-12-01');
    expect(ymd(end)).toBe('2025-12-31');
  });

  it('last 3 months starts two months back and ends this month', () => {
    const { start, end } = rangeFor('3m', new Date(2026, 2, 20));
    expect(ymd(start)).toBe('2026-01-01');
    expect(ymd(end)).toBe('2026-03-31');
  });

  it('year to date starts Jan 1 and last 12 months includes the previous year', () => {
    const now = new Date(2026, 2, 15);
    expect(ymd(rangeFor('ytd', now).start)).toBe('2026-01-01');
    expect(ymd(rangeFor('12m', now).start)).toBe('2025-04-01');
    expect(ymd(rangeFor('12m', now).end)).toBe('2026-03-31');
  });
});

describe('resolveReportRange', () => {
  it('swaps a backwards custom range so CSV/KPIs still cover the days the user picked', () => {
    const { start, end } = resolveReportRange('custom', '2026-03-20', '2026-03-01', new Date(2026, 5, 1));
    expect(ymd(start)).toBe('2026-03-01');
    expect(ymd(end)).toBe('2026-03-20');
  });
});
