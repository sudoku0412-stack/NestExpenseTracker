import { describe, expect, it } from 'vitest';
import { historyChartPoints, investmentHistoryRows, type HistorySnap } from '../investmentHistory';

const snap = (o: Partial<HistorySnap> & Pick<HistorySnap, 'id' | 'accountId' | 'date'>): HistorySnap => ({
  valueUsd: 1,
  contributedUsd: 1,
  createdAt: o.date,
  ...o,
});

describe('investmentHistoryRows', () => {
  it('keeps only that account and sorts by date, then createdAt', () => {
    const rows = investmentHistoryRows(
      [
        snap({ id: 'other', accountId: 'b', date: '2026-01-01' }),
        snap({ id: 'late', accountId: 'a', date: '2026-03-01' }),
        snap({ id: 'early', accountId: 'a', date: '2026-01-01' }),
        snap({ id: 'same-day-2', accountId: 'a', date: '2026-02-01', createdAt: '2026-02-01T18:00:00Z' }),
        snap({ id: 'same-day-1', accountId: 'a', date: '2026-02-01', createdAt: '2026-02-01T08:00:00Z' }),
      ],
      'a',
    );
    expect(rows.map((r) => r.id)).toEqual(['early', 'same-day-1', 'same-day-2', 'late']);
  });
});

describe('historyChartPoints', () => {
  it('charts the last 12 rows and uses MM-DD so the axis stays short', () => {
    const rows = Array.from({ length: 14 }, (_, i) =>
      snap({ id: String(i), accountId: 'a', date: `2026-01-${String(i + 1).padStart(2, '0')}`, valueUsd: i }),
    );
    const pts = historyChartPoints(rows, 12);
    expect(pts).toHaveLength(12);
    expect(pts[0]).toEqual({ date: '01-03', value: 2 });
    expect(pts[11]).toEqual({ date: '01-14', value: 13 });
  });
});
