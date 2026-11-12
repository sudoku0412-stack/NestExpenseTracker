import {
  INVESTMENT_KINDS,
  parseInvestmentKind,
  accountGain,
  applyContribution,
  applyValueUpdate,
  gainLabel,
  snapshotBars,
  snapshotOf,
  summarizeInvestments,
} from '../lib/investments';
import type { InvestmentAccount, InvestmentSnapshot } from '../types';

const acct = (o: Partial<InvestmentAccount> = {}): InvestmentAccount => ({
  id: 'a1',
  name: 'TFSA',
  kind: 'etf',
  contributedUsd: 1000,
  valueUsd: 1200,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...o,
});

describe('accountGain / summarizeInvestments', () => {
  it('computes gain and percentage of contributions', () => {
    expect(accountGain(acct())).toEqual({ gainUsd: 200, gainPct: 20 });
    expect(accountGain(acct({ valueUsd: 900 }))).toEqual({ gainUsd: -100, gainPct: -10 });
  });

  it('percentage is null when nothing was contributed', () => {
    expect(accountGain(acct({ contributedUsd: 0, valueUsd: 50 }))).toEqual({ gainUsd: 50, gainPct: null });
  });

  it('sums accounts', () => {
    const s = summarizeInvestments([acct(), acct({ id: 'a2', contributedUsd: 500, valueUsd: 450 })]);
    expect(s).toEqual({ valueUsd: 1650, contributedUsd: 1500, gainUsd: 150, gainPct: 10 });
  });

  it('is zeroed for no accounts', () => {
    expect(summarizeInvestments([])).toEqual({ valueUsd: 0, contributedUsd: 0, gainUsd: 0, gainPct: null });
  });
});

describe('applyContribution / applyValueUpdate', () => {
  const now = '2026-02-01T00:00:00.000Z';

  it('a deposit raises contributions and value together', () => {
    const next = applyContribution(acct(), 300, now);
    expect(next).toMatchObject({ contributedUsd: 1300, valueUsd: 1500, updatedAt: now });
    expect(accountGain(next).gainUsd).toBe(200); // gain unchanged by the deposit itself
  });

  it('a withdrawal lowers both and never goes below zero', () => {
    expect(applyContribution(acct(), -400, now)).toMatchObject({ contributedUsd: 600, valueUsd: 800 });
    expect(applyContribution(acct(), -5000, now)).toMatchObject({ contributedUsd: 0, valueUsd: 0 });
  });

  it('a value update changes only the value', () => {
    expect(applyValueUpdate(acct(), 1500, now)).toMatchObject({ valueUsd: 1500, contributedUsd: 1000, updatedAt: now });
    expect(applyValueUpdate(acct(), -3, now).valueUsd).toBe(0);
  });

  it('does not mutate the input', () => {
    const a = acct();
    applyContribution(a, 100, now);
    applyValueUpdate(a, 5, now);
    expect(a).toEqual(acct());
  });
});

describe('snapshots', () => {
  const snap = (id: string, date: string, valueUsd: number): InvestmentSnapshot => ({
    id,
    accountId: 'a1',
    date,
    valueUsd,
    contributedUsd: 0,
    createdAt: '',
  });

  it('snapshotOf copies current value and contributions', () => {
    expect(snapshotOf(acct(), 's1', '2026-03-01', 'now')).toEqual({
      id: 's1',
      accountId: 'a1',
      date: '2026-03-01',
      valueUsd: 1200,
      contributedUsd: 1000,
      createdAt: 'now',
    });
  });

  it('snapshotBars returns oldest→newest, capped, scaled to the tallest', () => {
    const newestFirst = [snap('c', '2026-03', 200), snap('b', '2026-02', 100), snap('a', '2026-01', 50)];
    const bars = snapshotBars(newestFirst);
    expect(bars.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    expect(bars.map((b) => b.ratio)).toEqual([0.25, 0.5, 1]);
    expect(snapshotBars(newestFirst, 2).map((b) => b.id)).toEqual(['b', 'c']);
  });

  it('snapshotBars handles empty and all-zero input', () => {
    expect(snapshotBars([])).toEqual([]);
    expect(snapshotBars([snap('z', '2026-01', 0)])[0].ratio).toBe(0);
  });
});

describe('gainLabel', () => {
  const t = (key: string, p?: Record<string, string | number>) => `${key}:${JSON.stringify(p)}`;

  it('signs positive gains and includes the percentage', () => {
    expect(gainLabel(120, 8, 'USD', t as never)).toBe('invGainWithPct:{"amount":"+$120.00","pct":"+8.0"}');
  });

  it('shows losses without a plus and omits the percentage when unknown', () => {
    expect(gainLabel(-50, -5, 'USD', t as never)).toBe('invGainWithPct:{"amount":"-$50.00","pct":"-5.0"}');
    expect(gainLabel(30, null, 'USD', t as never)).toBe('+$30.00');
  });
});

describe('INVESTMENT_KINDS', () => {
  it('lists every kind once', () => {
    expect(new Set(INVESTMENT_KINDS).size).toBe(INVESTMENT_KINDS.length);
    expect(INVESTMENT_KINDS).toContain('other');
  });

  it('maps unknown cloud kinds to other', () => {
    expect(parseInvestmentKind('etf')).toBe('etf');
    expect(parseInvestmentKind('bonds')).toBe('other');
    expect(parseInvestmentKind(undefined)).toBe('other');
  });
});
