export interface HistorySnap {
  id: string;
  accountId: string;
  date: string;
  valueUsd: number;
  contributedUsd: number;
  createdAt: string;
}

/** One account, oldest first. Same-day rows keep write order. */
export function investmentHistoryRows(snapshots: HistorySnap[], accountId: string): HistorySnap[] {
  return snapshots
    .filter((s) => s.accountId === accountId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export function historyChartPoints(rows: HistorySnap[], limit = 12): { date: string; value: number }[] {
  return rows.slice(-limit).map((r) => ({ date: r.date.slice(5), value: r.valueUsd }));
}
