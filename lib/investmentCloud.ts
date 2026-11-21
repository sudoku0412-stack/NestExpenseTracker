import type { InvestmentAccount, InvestmentKind, InvestmentSnapshot } from '../types';

/** Kinds the phone and web both persist. Unknown values become `other`. */
export const INVESTMENT_KINDS: InvestmentKind[] = ['stocks', 'etf', 'crypto', 'retirement', 'savings', 'other'];

/** Local ids that have not been uploaded yet, so a pre-sync holding reaches the web app. */
export function missingCloudIds(localIds: string[], cloudIds: Iterable<string>): string[] {
  const have = new Set(cloudIds);
  return localIds.filter((id) => !have.has(id));
}

export function mapInvestmentAccountFromCloud(
  id: string,
  d: Record<string, unknown>,
  now: string,
): InvestmentAccount {
  return {
    id,
    name: (d.name as string) || '',
    kind: INVESTMENT_KINDS.includes(d.kind as InvestmentKind) ? (d.kind as InvestmentKind) : 'other',
    contributedUsd: (d.contributedUsd as number) || 0,
    valueUsd: (d.valueUsd as number) || 0,
    notes: (d.notes as string | null) ?? undefined,
    createdAt: (d.createdAt as string) || now,
    updatedAt: (d.updatedAt as string) || now,
  };
}

export function mapInvestmentSnapshotFromCloud(
  id: string,
  d: Record<string, unknown>,
  now: string,
): InvestmentSnapshot {
  return {
    id,
    accountId: (d.accountId as string) || '',
    date: (d.date as string) || '',
    valueUsd: (d.valueUsd as number) || 0,
    contributedUsd: (d.contributedUsd as number) || 0,
    createdAt: (d.createdAt as string) || now,
  };
}

/** Document body written to users/{uid}/investmentAccounts/{id} (id is the doc id). */
export function serializeInvestmentAccount(account: InvestmentAccount): Record<string, unknown> {
  return {
    name: account.name,
    kind: account.kind,
    contributedUsd: account.contributedUsd,
    valueUsd: account.valueUsd,
    notes: account.notes ?? null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export function serializeInvestmentSnapshot(snapshot: InvestmentSnapshot): Record<string, unknown> {
  return {
    accountId: snapshot.accountId,
    date: snapshot.date,
    valueUsd: snapshot.valueUsd,
    contributedUsd: snapshot.contributedUsd,
    createdAt: snapshot.createdAt,
  };
}
