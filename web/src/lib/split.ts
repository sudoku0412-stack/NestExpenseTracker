import { convertEntryToUsd, type CurrencyCode } from '@app/lib/currency';
import type { Receipt } from '@app/types';

export type SplitMethod = 'equal' | 'percent' | 'amount' | 'shares';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mobile used to persist the literal 'self'; the web must store a real uid. */
export const remapSelfId = (id: string, selfUid: string): string => (id === 'self' ? selfUid : id);

export function remapSelfKeyedRecord(values: Record<string, unknown>, selfUid: string): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [remapSelfId(k, selfUid), String(v)]));
}

export type SplitBuildResult =
  | { ok: true; split: Receipt['split'] | null }
  | { ok: false; error: string };

/** Builds the Firestore split payload. Amounts typed in the entry currency are stored USD-canonical. */
export function buildSplitPayload(args: {
  enabled: boolean;
  method: SplitMethod;
  people: string[];
  vals: Record<string, string>;
  totalInEntryCurrency: number;
  currency: CurrencyCode;
}): SplitBuildResult {
  if (!args.enabled) return { ok: true, split: null };
  if (args.people.length < 2) return { ok: false, error: 'Choose at least two people to split with.' };
  const v: Record<string, number> = {};
  if (args.method !== 'equal') for (const p of args.people) v[p] = Number(args.vals[p]) || 0;
  if (args.method === 'percent' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - 100) > 0.01) {
    return { ok: false, error: 'Percentages must add up to 100.' };
  }
  if (args.method === 'amount' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - args.totalInEntryCurrency) > 0.01) {
    return { ok: false, error: 'Amounts must add up to the total.' };
  }
  if (args.method === 'shares' && Object.values(v).every((x) => x <= 0)) {
    return { ok: false, error: 'Give at least one person a share.' };
  }
  const stored =
    args.method === 'amount'
      ? Object.fromEntries(Object.entries(v).map(([k, n]) => [k, round2(convertEntryToUsd(n, args.currency))]))
      : v;
  return {
    ok: true,
    split: {
      enabled: true,
      method: args.method,
      participantIds: args.people,
      ...(args.method === 'equal' ? {} : { values: stored }),
    },
  };
}

export function lineItemsAreValid(items: { name: string; amount: string }[]): boolean {
  return !items.some((i) => !i.name.trim() || !(Number(i.amount) !== 0 && Number.isFinite(Number(i.amount))));
}
