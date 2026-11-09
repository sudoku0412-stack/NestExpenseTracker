import { describe, expect, it } from 'vitest';
import { parseYmd, rangeFor, resolveReportRange } from '../reportRange';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('rangeFor', () => {
  const now = new Date(2026, 2, 15); // 15 Mar 2026, local

  it('this month is the civil month containing now', () => {
    const r = rangeFor('month', now);
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('last month crosses a year boundary', () => {
    const r = rangeFor('last', new Date(2026, 0, 10));
    expect(ymd(r.start)).toBe('2025-12-01');
    expect(ymd(r.end)).toBe('2025-12-31');
  });

  it('last 3 months starts on the first of two months ago and ends this month', () => {
    const r = rangeFor('3m', now);
    expect(ymd(r.start)).toBe('2026-01-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('year to date starts 1 Jan', () => {
    const r = rangeFor('ytd', now);
    expect(ymd(r.start)).toBe('2026-01-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });

  it('last 12 months is inclusive of this month', () => {
    const r = rangeFor('12m', now);
    expect(ymd(r.start)).toBe('2025-04-01');
    expect(ymd(r.end)).toBe('2026-03-31');
  });
});

describe('resolveReportRange', () => {
  it('swaps a backwards custom range so start is never after end', () => {
    const r = resolveReportRange('custom', '2026-04-10', '2026-03-01', new Date());
    expect(ymd(r.start)).toBe('2026-03-01');
    expect(ymd(r.end)).toBe('2026-04-10');
  });

  it('parses YYYY-MM-DD as a local civil date, not UTC midnight', () => {
    const d = parseYmd('2026-03-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(1);
  });
});
