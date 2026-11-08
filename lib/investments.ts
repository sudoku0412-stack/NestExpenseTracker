import { formatCurrency, type CurrencyCode } from './currency';
import type { TFn } from './I18nContext';
import type { TranslationKey } from './i18n';
import type { InvestmentAccount, InvestmentKind, InvestmentSnapshot } from '../types';

export const INVESTMENT_KINDS: InvestmentKind[] = [
  'stocks',
  'etf',
  'crypto',
  'retirement',
  'savings',
  'other',
];

/** Maps a users/{uid}/investmentAccounts Firestore doc onto the local shape.
 *  Unknown kinds become `other` so a bad write cannot crash the phone or web. */
export function investmentAccountFromCloud(
  id: string,
  d: Record<string, unknown>,
  nowIso = new Date().toISOString(),
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

export function investmentSnapshotFromCloud(
  id: string,
  d: Record<string, unknown>,
  nowIso = new Date().toISOString(),
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

export const INVESTMENT_KIND_KEYS: Record<InvestmentKind, TranslationKey> = {
  stocks: 'invKindStocks',
  etf: 'invKindEtf',
  crypto: 'invKindCrypto',
  retirement: 'invKindRetirement',
  savings: 'invKindSavings',
  other: 'invKindOther',
};

export const INVESTMENT_KIND_ICONS: Record<InvestmentKind, string> = {
  stocks: '📈',
  etf: '🧺',
  crypto: '🪙',
  retirement: '🏖️',
  savings: '🏦',
  other: '💼',
};

export interface InvestmentSummary {
  valueUsd: number;
  contributedUsd: number;
  gainUsd: number;
  /** Gain as a percentage of what was contributed; null when nothing was contributed. */
  gainPct: number | null;
}

export function accountGain(a: Pick<InvestmentAccount, 'valueUsd' | 'contributedUsd'>): {
  gainUsd: number;
  gainPct: number | null;
} {
  const gainUsd = a.valueUsd - a.contributedUsd;
  return { gainUsd, gainPct: a.contributedUsd > 0 ? (gainUsd / a.contributedUsd) * 100 : null };
}

export function summarizeInvestments(accounts: InvestmentAccount[]): InvestmentSummary {
  const valueUsd = accounts.reduce((s, a) => s + a.valueUsd, 0);
  const contributedUsd = accounts.reduce((s, a) => s + a.contributedUsd, 0);
  return { valueUsd, contributedUsd, ...accountGain({ valueUsd, contributedUsd }) };
}

/** Deposit (positive) or withdrawal (negative): contributions and value
 *  move together; neither goes below zero. Adjust the value afterwards to
 *  record market movement. */
export function applyContribution(
  account: InvestmentAccount,
  deltaUsd: number,
  nowIso: string,
): InvestmentAccount {
  return {
    ...account,
    contributedUsd: Math.max(0, account.contributedUsd + deltaUsd),
    valueUsd: Math.max(0, account.valueUsd + deltaUsd),
    updatedAt: nowIso,
  };
}

/** Record the account's current market value (contributions unchanged). */
export function applyValueUpdate(
  account: InvestmentAccount,
  valueUsd: number,
  nowIso: string,
): InvestmentAccount {
  return { ...account, valueUsd: Math.max(0, valueUsd), updatedAt: nowIso };
}

export function snapshotOf(
  account: InvestmentAccount,
  id: string,
  dateYmd: string,
  nowIso: string,
): InvestmentSnapshot {
  return {
    id,
    accountId: account.id,
    date: dateYmd,
    valueUsd: account.valueUsd,
    contributedUsd: account.contributedUsd,
    createdAt: nowIso,
  };
}

export interface SnapshotBar {
  id: string;
  date: string;
  valueUsd: number;
  /** 0–1 relative to the tallest bar shown. */
  ratio: number;
}

/** Oldest → newest, at most `max` most recent snapshots, scaled for a bar chart. */
export function snapshotBars(snapshotsNewestFirst: InvestmentSnapshot[], max = 12): SnapshotBar[] {
  const recent = snapshotsNewestFirst.slice(0, max).reverse();
  const top = Math.max(0, ...recent.map((s) => s.valueUsd));
  return recent.map((s) => ({
    id: s.id,
    date: s.date,
    valueUsd: s.valueUsd,
    ratio: top > 0 ? s.valueUsd / top : 0,
  }));
}

/** "+$120.00 (+8.0%)" — gain line shared by the summary and each account. */
export function gainLabel(
  gainUsd: number,
  gainPct: number | null,
  currency: CurrencyCode,
  t: TFn,
): string {
  const sign = gainUsd > 0 ? '+' : gainUsd < 0 ? '-' : '';
  const amount = `${sign}${formatCurrency(Math.abs(gainUsd), currency)}`;
  const pct = `${sign}${Math.abs(gainPct ?? 0).toFixed(1)}`;
  return gainPct == null ? amount : t('invGainWithPct', { amount, pct });
}
