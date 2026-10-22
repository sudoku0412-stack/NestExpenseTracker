import {
  calendarDateKey,
  calendarMonthSqlParams,
  isInCalendarMonth,
  isInCalendarRange,
} from '../lib/calendarDate';
import { filterReceiptsInRange } from '../lib/reports';
import { Receipt } from '../types';

const receipt = (date: string): Receipt => ({
  id: date,
  storeName: 'Store',
  date,
  totalAmount: 10,
  category: 'Other',
  createdAt: date,
  updatedAt: date,
});

describe('calendar dates', () => {
  it('keeps a YYYY-MM-DD string on that civil day in every timezone', () => {
    expect(calendarDateKey('2026-03-01')).toBe('2026-03-01');
    expect(isInCalendarMonth('2026-03-01', 2026, 3)).toBe(true);
    expect(isInCalendarMonth('2026-03-01', 2026, 2)).toBe(false);
  });

  it('puts a local-midnight ISO timestamp on that local calendar day', () => {
    const iso = new Date(2026, 2, 1, 0, 0, 0, 0).toISOString();
    expect(calendarDateKey(iso)).toBe('2026-03-01');
    expect(isInCalendarMonth(iso, 2026, 3)).toBe(true);
  });

  it('puts a local-evening ISO timestamp on that local calendar day, not the next UTC day', () => {
    const iso = new Date(2026, 2, 1, 20, 0, 0).toISOString();
    expect(calendarDateKey(iso)).toBe('2026-03-01');
  });

  it('binds date-only start/end plus local-midnight ISO bounds for SQL month filters', () => {
    const params = calendarMonthSqlParams(2026, 3);
    expect(params[0]).toBe('2026-03-01');
    expect(params[1]).toBe('2026-03-31');
    expect(params[2]).toBe(new Date(2026, 2, 1, 0, 0, 0, 0).toISOString());
    expect(params[3]).toBe(new Date(2026, 2, 31, 23, 59, 59, 999).toISOString());
  });

  it('includes date-only day-1 receipts in the same month as date-only income', () => {
    const march = filterReceiptsInRange(
      [receipt('2026-03-01'), receipt('2026-02-28'), receipt('2026-04-01')],
      new Date(2026, 2, 1),
      new Date(2026, 2, 31),
    );
    expect(march.map((r) => r.date)).toEqual(['2026-03-01']);
    expect(isInCalendarRange('2026-03-01', new Date(2026, 2, 1), new Date(2026, 2, 31))).toBe(true);
  });
});
