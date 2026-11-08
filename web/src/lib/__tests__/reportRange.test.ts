import { describe, expect, it } from 'vitest';
import { parseYmd, rangeFor, resolveReportRange } from '../reportRange';

describe('rangeFor', () => {
  it('this month is the first through last day of the current month', () => {
    const { start, end } = rangeFor('month', new Date(2026, 10, 8));
    expect(start).toEqual(new Date(2026, 10, 1));
    expect(end).toEqual(new Date(2026, 10, 30));
  });

  it('last month crosses a year boundary', () => {
    const { start, end } = rangeFor('last', new Date(2026, 0, 15));
    expect(start).toEqual(new Date(2025, 11, 1));
    expect(end).toEqual(new Date(2025, 11, 31));
  });

  it('last 3 months starts two months back and ends this month', () => {
    const { start, end } = rangeFor('3m', new Date(2026, 2, 10));
    expect(start).toEqual(new Date(2026, 0, 1));
    expect(end).toEqual(new Date(2026, 2, 31));
  });

  it('year to date starts Jan 1', () => {
    const { start, end } = rangeFor('ytd', new Date(2026, 5, 2));
    expect(start).toEqual(new Date(2026, 0, 1));
    expect(end).toEqual(new Date(2026, 5, 30));
  });

  it('last 12 months starts eleven months back', () => {
    const { start, end } = rangeFor('12m', new Date(2026, 10, 8));
    expect(start).toEqual(new Date(2025, 11, 1));
    expect(end).toEqual(new Date(2026, 10, 30));
  });
});

describe('resolveReportRange custom', () => {
  it('swaps inverted custom dates so start is never after end', () => {
    const { start, end } = resolveReportRange('custom', '2026-03-10', '2026-03-01', new Date());
    expect(start).toEqual(parseYmd('2026-03-01'));
    expect(end).toEqual(parseYmd('2026-03-10'));
  });
});
