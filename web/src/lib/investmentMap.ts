import type { InvestmentAccount, InvestmentKind, InvestmentSnapshot } from '@app/types';

type CloudDoc = Record<string, unknown>;
const KINDS: InvestmentKind[] = ['stocks', 'etf', 'crypto', 'retirement', 'savings', 'other'];
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function mapWebInvestmentAccount(id: string, d: CloudDoc): InvestmentAccount {
  return {
    id,
    name: str(d.name),
    kind: KINDS.includes(d.kind as InvestmentKind) ? (d.kind as InvestmentKind) : 'other',
    contributedUsd: num(d.contributedUsd),
    valueUsd: num(d.valueUsd),
    notes: typeof d.notes === 'string' ? d.notes : undefined,
    createdAt: str(d.createdAt),
    updatedAt: str(d.updatedAt),
  };
}

export function mapWebInvestmentSnapshot(id: string, d: CloudDoc): InvestmentSnapshot {
  return {
    id,
    accountId: str(d.accountId),
    date: str(d.date),
    valueUsd: num(d.valueUsd),
    contributedUsd: num(d.contributedUsd),
    createdAt: str(d.createdAt),
  };
}
