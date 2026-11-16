import type { InvestmentAccount, InvestmentKind, InvestmentSnapshot } from '../types';

const INVESTMENT_KINDS: InvestmentKind[] = ['stocks', 'etf', 'crypto', 'retirement', 'savings', 'other'];

/** Shape a Firestore investment account doc into the local type. Unknown
 *  kinds become `other` so a stale/web-written value cannot crash the phone. */
export function mapInvestmentAccountFromCloud(
  id: string,
  d: Record<string, unknown>,
  nowIso: string,
): InvestmentAccount {
  return {
    id,
    name: (d.name as string) || '',
    kind: INVESTMENT_KINDS.includes(d.kind as InvestmentKind) ? (d.kind as InvestmentKind) : 'other',
    contributedUsd: (d.contributedUsd as number) || 0,
    valueUsd: (d.valueUsd as number) || 0,
    notes: (d.notes as string | null) ?? undefined,
    createdAt: (d.createdAt as string) || nowIso,
    updatedAt: (d.updatedAt as string) || nowIso,
  };
}

export function mapInvestmentSnapshotFromCloud(
  id: string,
  d: Record<string, unknown>,
  nowIso: string,
): InvestmentSnapshot {
  return {
    id,
    accountId: (d.accountId as string) || '',
    date: (d.date as string) || '',
    valueUsd: (d.valueUsd as number) || 0,
    contributedUsd: (d.contributedUsd as number) || 0,
    createdAt: (d.createdAt as string) || nowIso,
  };
}
