import { describe, expect, it } from 'vitest';
import { advance, buildSchedule, endDateAfter } from '../schedule';

describe('advance', () => {
  it('moves one period ahead for every frequency', () => {
    expect(advance('2026-01-10', 'weekly')).toBe('2026-01-17');
    expect(advance('2026-01-10', 'biweekly')).toBe('2026-01-24');
    expect(advance('2026-01-10', 'monthly')).toBe('2026-02-10');
    expect(advance('2026-01-10', 'yearly')).toBe('2027-01-10');
  });
  it('clamps to the end of a shorter month instead of spilling over', () => {
    expect(advance('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advance('2024-02-29', 'yearly')).toBe('2025-02-28');
  });
  it('crosses a year boundary', () => {
    expect(advance('2026-12-20', 'monthly')).toBe('2027-01-20');
    expect(advance('2026-12-28', 'weekly')).toBe('2027-01-04');
  });
});

describe('buildSchedule', () => {
  it('returns null when repeating is off', () => {
    expect(buildSchedule(false, 'monthly', '2026-01-10', 12)).toBeNull();
  });
  it('seeds nextDueDate one period ahead (the entry itself is occurrence zero) and computes the end date', () => {
    expect(buildSchedule(true, 'monthly', '2026-01-10', 6)).toEqual({ frequency: 'monthly', nextDueDate: '2026-02-10', endDate: '2026-07-10' });
  });
  it('keeps an existing end date when no duration is entered while editing', () => {
    expect(buildSchedule(true, 'weekly', '2026-01-10', 0, '2027-05-01')?.endDate).toBe('2027-05-01');
  });
  it('defaults to 12 months for a brand new schedule with no duration', () => {
    expect(buildSchedule(true, 'monthly', '2026-01-10', 0)?.endDate).toBe(endDateAfter('2026-01-10', 12));
  });
});
