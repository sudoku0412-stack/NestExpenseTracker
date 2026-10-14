import { describe, expect, it } from 'vitest';
import { daysInMonth } from '../stats';
import { monthSpendProjection, vsPreviousPct } from '../dashboardProjection';

describe('monthSpendProjection', () => {
  it('annualizes the daily average only for the current month', () => {
    const now = new Date(2026, 9, 10); // 10 Oct 2026
    const cur = monthSpendProjection(300, 2026, 10, now);
    expect(cur.isCurrent).toBe(true);
    expect(cur.elapsed).toBe(10);
    expect(cur.dayAvg).toBe(30);
    expect(cur.projected).toBe(30 * daysInMonth(2026, 10));
  });

  it('uses the real spend (not a projection) for a past closed month, including February length', () => {
    const now = new Date(2026, 9, 10);
    const past = monthSpendProjection(280, 2026, 2, now);
    expect(past.isCurrent).toBe(false);
    expect(past.elapsed).toBe(28);
    expect(past.dayAvg).toBe(10);
    expect(past.projected).toBe(280);

    const leap = monthSpendProjection(290, 2024, 2, new Date(2026, 0, 1));
    expect(leap.elapsed).toBe(29);
  });
});

describe('vsPreviousPct', () => {
  it('is null when last month had no spending so the KPI does not divide by zero', () => {
    expect(vsPreviousPct(100, 0)).toBeNull();
    expect(vsPreviousPct(120, 100)).toBe(20);
    expect(vsPreviousPct(80, 100)).toBe(-20);
  });
});
