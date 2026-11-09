import type { InvestmentAccount, InvestmentKind, InvestmentSnapshot } from '../types';

/** Kinds the phone and website both persist. Anything else from the cloud
 *  is treated as `other` so a typo cannot poison SQLite or the UI. */
export const INVESTMENT_KINDS: InvestmentKind[] = [
  'stocks',
  'etf',
  'crypto',
  'retirement',
  'savings',
  'other',
];

const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const asMoney = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Maps a Firestore investmentAccounts doc onto the local shape. */
export function mapCloudInvestmentAccount(
  id: string,
  d: Record<string, unknown>,
  nowIso = new Date().toISOString(),
): InvestmentAccount {
  const kind = d.kind as InvestmentKind;
  const notes = d.notes;
  return {
    id,
    name: asString(d.name),
    kind: INVESTMENT_KINDS.includes(kind) ? kind : 'other',
    contributedUsd: asMoney(d.contributedUsd),
    valueUsd: asMoney(d.valueUsd),
    notes: typeof notes === 'string' ? notes : undefined,
    createdAt: asString(d.createdAt, nowIso),
    updatedAt: asString(d.updatedAt, nowIso),
  };
}

/** Maps a Firestore investmentSnapshots doc onto the local shape. */
export function mapCloudInvestmentSnapshot(
  id: string,
  d: Record<string, unknown>,
  nowIso = new Date().toISOString(),
): InvestmentSnapshot {
  return {
    id,
    accountId: asString(d.accountId),
    date: asString(d.date),
    valueUsd: asMoney(d.valueUsd),
    contributedUsd: asMoney(d.contributedUsd),
    createdAt: asString(d.createdAt, nowIso),
  };
}
