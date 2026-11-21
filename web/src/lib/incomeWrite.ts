import { convertEntryToUsd, type CurrencyCode } from '@app/lib/currency';
import type { IncomeCategory } from '@app/types';
import { buildSchedule, type Frequency } from './schedule';

export function validateIncome(source: string, amount: number, earnedBy: string): string | null {
  if (!source.trim()) return 'Enter where the money came from.';
  if (!(amount > 0)) return 'Enter an amount greater than zero.';
  if (!earnedBy) return 'Choose who earned it.';
  return null;
}

export function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Firestore body for an income. Date stays civil YYYY-MM-DD (unlike receipts). */
export function buildIncomePayload(input: {
  isNew: boolean;
  source: string;
  date: string;
  amount: number;
  currency: CurrencyCode;
  category: IncomeCategory;
  earnedBy: string;
  notes: string;
  createdBy: string;
  now: string;
  repeating: { enabled: boolean; frequency: Frequency; months: string };
  existingEnd?: string;
}): Record<string, unknown> {
  return {
    sourceName: input.source.trim(),
    date: input.date,
    amountUsd: roundUsd(convertEntryToUsd(input.amount, input.currency)),
    category: input.category,
    earnedBy: input.earnedBy,
    notes: input.notes.trim() || null,
    originalCurrency: input.currency,
    recurring: buildSchedule(
      input.repeating.enabled,
      input.repeating.frequency,
      input.date,
      parseInt(input.repeating.months, 10) || 0,
      input.existingEnd,
    ),
    ...(input.isNew ? { isRecurringOccurrence: false, createdBy: input.createdBy, createdAt: input.now } : {}),
    updatedAt: input.now,
  };
}
