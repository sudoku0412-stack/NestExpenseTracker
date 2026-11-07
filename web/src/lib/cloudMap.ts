import type { Income, InvestmentAccount, InvestmentKind, InvestmentSnapshot, Receipt, SavingsGoal, Settlement } from '@app/types';

type Doc = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const INVESTMENT_KINDS: InvestmentKind[] = ['stocks', 'etf', 'crypto', 'retirement', 'savings', 'other'];

export function toReceipt(id: string, d: Doc, householdId: string): Receipt {
  const items = Array.isArray(d.lineItems) ? d.lineItems : [];
  return {
    id,
    storeName: str(d.storeName, 'Unknown'),
    date: str(d.date),
    totalAmount: num(d.totalAmount),
    subtotalAmount: (d.subtotalAmount as number | null | undefined) ?? undefined,
    taxAmount: (d.taxAmount as number | null | undefined) ?? undefined,
    category: str(d.category, 'Other'),
    categoryTags: Array.isArray(d.categoryTags) ? (d.categoryTags as string[]) : undefined,
    notes: (d.notes as string | null | undefined) ?? undefined,
    photoUrl: (d.photoUrl as string | undefined) ?? undefined,
    originalCurrency: (d.originalCurrency as Receipt['originalCurrency']) ?? undefined,
    paidBy: (d.paidBy as string | undefined) ?? undefined,
    createdBy: (d.createdBy as string | undefined) ?? undefined,
    split: (d.split as Receipt['split']) ?? undefined,
    recurring: (d.recurring as Receipt['recurring']) ?? undefined,
    isRecurringOccurrence: Boolean(d.isRecurringOccurrence),
    lineItems: items.map((it: Doc, i: number) => ({
      id: str(it.id, `${id}-${i}`),
      name: str(it.name),
      amount: num(it.amount),
      category: (it.category as string | undefined) ?? undefined,
      splitWith: (it.splitWith as string[] | undefined) ?? undefined,
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
    notes: (d.notes as string | null | undefined) ?? undefined,
    originalCurrency: (d.originalCurrency as Income['originalCurrency']) ?? undefined,
    recurring: (d.recurring as Income['recurring']) ?? undefined,
    isRecurringOccurrence: Boolean(d.isRecurringOccurrence),
    createdBy: (d.createdBy as string | undefined) ?? undefined,
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
    notes: (d.notes as string | null | undefined) ?? undefined,
    householdId,
    createdAt: str(d.createdAt),
    updatedAt: str(d.updatedAt),
  };
}

export function toInvestmentAccount(id: string, d: Doc): InvestmentAccount {
  const kind = d.kind as InvestmentKind;
  return {
    id,
    name: str(d.name),
    kind: INVESTMENT_KINDS.includes(kind) ? kind : 'other',
    contributedUsd: num(d.contributedUsd),
    valueUsd: num(d.valueUsd),
    notes: (d.notes as string | null | undefined) ?? undefined,
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
  user: { displayName?: unknown; email?: unknown } | undefined,
): { uid: string; name: string; email: string | null } {
  const email = (typeof user?.email === 'string' ? user.email : null) ?? null;
  return { uid, name: str(user?.displayName) || email?.split('@')[0] || 'Member', email };
}
