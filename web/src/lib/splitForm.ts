import type { Receipt } from '@app/types';

export type SplitMethod = 'equal' | 'percent' | 'amount' | 'shares';

export function remapSelfId(id: string, uid: string | undefined): string {
  return id === 'self' ? uid ?? id : id;
}

export function remapSelfMap<T>(values: Record<string, T>, uid: string | undefined): Record<string, T> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [remapSelfId(k, uid), v]));
}

export function buildSplit(
  splitOn: boolean,
  method: SplitMethod,
  people: string[],
  vals: Record<string, string>,
  totalN: number,
  toStoredAmount: (n: number) => number,
): { error: string } | { split: Receipt['split'] | null } {
  if (!splitOn) return { split: null };
  if (people.length < 2) return { error: 'Choose at least two people to split with.' };
  const v: Record<string, number> = {};
  if (method !== 'equal') for (const p of people) v[p] = Number(vals[p]) || 0;
  if (method === 'percent' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - 100) > 0.01) {
    return { error: 'Percentages must add up to 100.' };
  }
  if (method === 'amount' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - totalN) > 0.01) {
    return { error: 'Amounts must add up to the total.' };
  }
  if (method === 'shares' && Object.values(v).every((x) => x <= 0)) {
    return { error: 'Give at least one person a share.' };
  }
  const stored = method === 'amount'
    ? Object.fromEntries(Object.entries(v).map(([k, n]) => [k, toStoredAmount(n)]))
    : v;
  return {
    split: { enabled: true, method, participantIds: people, ...(method === 'equal' ? {} : { values: stored }) },
  };
}
