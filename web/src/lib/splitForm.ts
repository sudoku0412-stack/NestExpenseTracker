import { convertEntryToUsd, type CurrencyCode } from '@app/lib/currency';
import type { Receipt } from '@app/types';

export type SplitMethod = 'equal' | 'percent' | 'amount' | 'shares';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Legacy mobile splits keyed the signed-in user as `self`; web forms store real uids. */
export function remapSelfId(id: string, uid: string | undefined): string {
  return id === 'self' ? uid ?? id : id;
}

export function buildSplit(opts: {
  enabled: boolean;
  method: SplitMethod;
  people: string[];
  vals: Record<string, string>;
  totalN: number;
  currency: CurrencyCode;
}): { error: string } | { split: Receipt['split'] | null } {
  if (!opts.enabled) return { split: null };
  if (opts.people.length < 2) return { error: 'Choose at least two people to split with.' };
  const v: Record<string, number> = {};
  if (opts.method !== 'equal') for (const p of opts.people) v[p] = Number(opts.vals[p]) || 0;
  if (opts.method === 'percent' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - 100) > 0.01) {
    return { error: 'Percentages must add up to 100.' };
  }
  if (opts.method === 'amount' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - opts.totalN) > 0.01) {
    return { error: 'Amounts must add up to the total.' };
  }
  if (opts.method === 'shares' && Object.values(v).every((x) => x <= 0)) {
    return { error: 'Give at least one person a share.' };
  }
  const stored =
    opts.method === 'amount'
      ? Object.fromEntries(Object.entries(v).map(([k, n]) => [k, round2(convertEntryToUsd(n, opts.currency))]))
      : v;
  return {
    split: {
      enabled: true,
      method: opts.method,
      participantIds: opts.people,
      ...(opts.method === 'equal' ? {} : { values: stored }),
    },
  };
}
