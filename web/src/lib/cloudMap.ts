import { parseInvestmentKind } from '@app/lib/investments';
import type { Income, InvestmentAccount, InvestmentSnapshot, Receipt, SavingsGoal, Settlement } from '@app/types';

type Doc = Record<string, unknown>;

export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
export const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function toReceipt(id: string, d: Doc, householdId: string): Receipt {
  const items = Array.isArray(d.lineItems) ? (d.lineItems as Doc[]) : [];
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

export function toSettlement(id: string, d: Doc, householdId: string): Settlement {
  return {
    id,
    fromUid: str(d.fromUid),
    toUid: str(d.toUid),
    amountUsd: num(d.amountUsd),
    createdAt: str(d.createdAt),
    householdId,
  };
}

export function toGoal(id: string, d: Doc, householdId: string): SavingsGoal {
  return {
    id,
    name: str(d.name),
    targetUsd: num(d.targetUsd),
    allocatedUsd: num(d.allocatedUsd),
    notes: d.notes ?? undefined,
    householdId,
    createdAt: str(d.createdAt),
    updatedAt: str(d.updatedAt),
  };
}

export function toInvestmentAccount(id: string, d: Doc): InvestmentAccount {
  return {
    id,
    name: str(d.name),
    kind: parseInvestmentKind(d.kind),
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

export function memberFromUserDoc(
  uid: string,
  u: Doc | undefined,
): { uid: string; name: string; email: string | null } {
  const email = (typeof u?.email === 'string' ? u.email : null);
  return { uid, name: str(u?.displayName) || email?.split('@')[0] || 'Member', email };
}

export function householdBudgetState(d: Doc): {
  budgets: Record<string, number>;
  budgetAlerts: boolean;
  customCategories: unknown[];
} {
  const budgets = d.budgets as { byCategory?: Record<string, number>; alertsEnabled?: boolean } | undefined;
  return {
    budgets: (budgets?.byCategory as Record<string, number>) ?? {},
    budgetAlerts: budgets?.alertsEnabled !== false,
    customCategories: Array.isArray(d.customCategories) ? d.customCategories : [],
  };
}
