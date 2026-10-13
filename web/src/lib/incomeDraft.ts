import { convertEntryToUsd, type CurrencyCode } from '@app/lib/currency';
import type { IncomeCategory } from '@app/types';
import { buildSchedule, type Frequency } from './schedule';

export function validateIncomeDraft(input: { source: string; amount: string; earnedBy: string }): string | null {
  if (!input.source.trim()) return 'Enter where the money came from.';
  if (!(Number(input.amount) > 0)) return 'Enter an amount greater than zero.';
  if (!input.earnedBy) return 'Choose who earned it.';
  return null;
}

export function buildIncomeWrite(input: {
  source: string;
  date: string;
  amount: string;
  category: IncomeCategory;
  earnedBy: string;
  notes: string;
  currency: CurrencyCode;
  repeat: { enabled: boolean; frequency: Frequency; months: string };
  existingEndDate?: string;
  now: string;
  createdBy: string;
  isNew: boolean;
}): Record<string, unknown> {
  const n = Number(input.amount);
  return {
    sourceName: input.source.trim(),
    date: input.date,
    amountUsd: Math.round(convertEntryToUsd(n, input.currency) * 100) / 100,
    category: input.category,
    earnedBy: input.earnedBy,
    notes: input.notes.trim() || null,
    originalCurrency: input.currency,
    recurring: buildSchedule(input.repeat.enabled, input.repeat.frequency, input.date, parseInt(input.repeat.months, 10) || 0, input.existingEndDate),
    ...(input.isNew ? { isRecurringOccurrence: false, createdBy: input.createdBy, createdAt: input.now } : {}),
    updatedAt: input.now,
  };
}
