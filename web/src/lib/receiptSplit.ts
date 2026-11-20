import { convertEntryToUsd, type CurrencyCode } from '@app/lib/currency';
import type { Receipt } from '@app/types';

export type SplitMethod = 'equal' | 'percent' | 'amount' | 'shares';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Older receipts stored the signed-in user as the literal "self". Resolve to a real uid at save time. */
export function resolveParticipantIds(ids: string[], selfUid: string): string[] {
  return ids.map((id) => (id === 'self' ? selfUid || id : id));
}

export type SplitResult =
  | { ok: true; split: Receipt['split'] }
  | { ok: false; error: string };

/** Build the Firestore split payload, converting amount splits into USD. */
export function buildReceiptSplit(
  people: string[],
  method: SplitMethod,
  vals: Record<string, string>,
  totalInEntryCurrency: number,
  currency: CurrencyCode,
): SplitResult {
  if (people.length < 2) return { ok: false, error: 'Choose at least two people to split with.' };
  const v: Record<string, number> = {};
  if (method !== 'equal') for (const p of people) v[p] = Number(vals[p]) || 0;
  if (method === 'percent' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - 100) > 0.01) {
    return { ok: false, error: 'Percentages must add up to 100.' };
  }
  if (method === 'amount' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - totalInEntryCurrency) > 0.01) {
    return { ok: false, error: 'Amounts must add up to the total.' };
  }
  if (method === 'shares' && Object.values(v).every((x) => x <= 0)) {
    return { ok: false, error: 'Give at least one person a share.' };
  }
  const stored =
    method === 'amount'
      ? Object.fromEntries(Object.entries(v).map(([k, n]) => [k, round2(convertEntryToUsd(n, currency))]))
      : v;
  return {
    ok: true,
    split: { enabled: true, method, participantIds: people, ...(method === 'equal' ? {} : { values: stored }) },
  };
}
