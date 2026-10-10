import type { Income, InvestmentAccount, InvestmentKind, InvestmentSnapshot, Receipt } from '@app/types';

const INVESTMENT_KINDS: InvestmentKind[] = ['stocks', 'etf', 'crypto', 'retirement', 'savings', 'other'];

export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

type Doc = Record<string, unknown>;

/** Firestore receipt → app Receipt. Missing/corrupt fields must not crash the dashboard. */
export function toReceipt(id: string, d: Doc, householdId: string): Receipt {
  const items = Array.isArray(d.lineItems) ? d.lineItems : [];
  return {
    id,
    storeName: str(d.storeName, 'Unknown'),
    date: str(d.date),
    totalAmount: num(d.totalAmount),
    subtotalAmount: d.subtotalAmount ?? undefined,
    taxAmount: d.taxAmount ?? undefined,
    category: str(d.category, 'Other'),
    categoryTags: Array.isArray(d.categoryTags) ? d.categoryTags : undefined,
    notes: d.notes ?? undefined,
    photoUrl: d.photoUrl ?? undefined,
    originalCurrency: d.originalCurrency ?? undefined,
    paidBy: d.paidBy ?? undefined,
    createdBy: d.createdBy ?? undefined,
    split: d.split ?? undefined,
    recurring: d.recurring ?? undefined,
    isRecurringOccurrence: Boolean(d.isRecurringOccurrence),
    lineItems: items.map((it: Doc, i: number) => ({
      id: str(it.id, `${id}-${i}`),
      name: str(it.name),
      amount: num(it.amount),
      category: it.category ?? undefined,
      splitWith: it.splitWith ?? undefined,
    })),
    householdId,
    createdAt: str(d.createdAt),
    updatedAt: str(d.updatedAt),
  };
}

export function toIncome(id: string, d: Doc, householdId: string): Income {
  return {
    id,
    sourceName: str(d.sourceName, 'Income'),
    date: str(d.date),
    amountUsd: num(d.amountUsd),
    category: (d.category as Income['category']) ?? 'Other',
    earnedBy: str(d.earnedBy),
    notes: d.notes ?? undefined,
    originalCurrency: d.originalCurrency ?? undefined,
    recurring: d.recurring ?? undefined,
    isRecurringOccurrence: Boolean(d.isRecurringOccurrence),
    createdBy: d.createdBy ?? undefined,
    householdId,
    createdAt: str(d.createdAt),
    updatedAt: str(d.updatedAt),
  };
}

export function toInvestmentAccount(id: string, d: Doc): InvestmentAccount {
  return {
    id,
    name: str(d.name),
    kind: INVESTMENT_KINDS.includes(d.kind as InvestmentKind) ? (d.kind as InvestmentKind) : 'other',
    contributedUsd: num(d.contributedUsd),
    valueUsd: num(d.valueUsd),
    notes: d.notes ?? undefined,
    createdAt: str(d.createdAt),
    updatedAt: str(d.updatedAt),
  };
}

export function toInvestmentSnapshot(id: string, d: Doc): InvestmentSnapshot {
  return {
    id,
    accountId: str(d.accountId),
    date: str(d.date),
    valueUsd: num(d.valueUsd),
    contributedUsd: num(d.contributedUsd),
    createdAt: str(d.createdAt),
  };
}
