import { describe, expect, it } from 'vitest';
import { customRange, parseYmd, rangeFor } from '../reportRange';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('rangeFor', () => {
  it('this month is the first through last calendar day', () => {
    const r = rangeFor('month', new Date(2026, 1, 10)); // Feb
    expect(ymd(r.start)).toBe('2026-02-01');
    expect(ymd(r.end)).toBe('2026-02-28');
  });
  it('last month crosses the year boundary from January', () => {
    const r = rangeFor('last', new Date(2026, 0, 15));
    expect(ymd(r.start)).toBe('2025-12-01');
    expect(ymd(r.end)).toBe('2025-12-31');
  });
  it('last 3 months starts two months back and ends this month', () => {
    const r = rangeFor('3m', new Date(2026, 1, 1));
    expect(ymd(r.start)).toBe('2025-12-01');
    expect(ymd(r.end)).toBe('2026-02-28');
  });
  it('year to date starts Jan 1', () => {
    const r = rangeFor('ytd', new Date(2026, 2, 20));
    expect(ymd(r.start)).toBe('2026-01-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });
  it('last 12 months starts 11 months back', () => {
    const r = rangeFor('12m', new Date(2026, 0, 5));
    expect(ymd(r.start)).toBe('2025-02-01');
    expect(ymd(r.end)).toBe('2026-01-31');
  });
});

describe('customRange / parseYmd', () => {
  it('parses a date-only string as a local calendar day', () => {
    expect(ymd(parseYmd('2026-03-05'))).toBe('2026-03-05');
  });
  it('swaps inverted custom bounds so the filter still includes the days', () => {
    const r = customRange('2026-03-10', '2026-03-01');
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-10');
  });
});
