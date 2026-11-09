import {
  INVESTMENT_KINDS,
  mapCloudInvestmentAccount,
  mapCloudInvestmentSnapshot,
} from '../lib/investmentCloudMap';

describe('mapCloudInvestmentAccount', () => {
  it('copies a well-formed holding', () => {
    expect(
      mapCloudInvestmentAccount('a1', {
        name: 'TFSA',
        kind: 'etf',
        contributedUsd: 1000,
        valueUsd: 1200,
        notes: 'rrsp',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      }),
    ).toEqual({
      id: 'a1',
      name: 'TFSA',
      kind: 'etf',
      contributedUsd: 1000,
      valueUsd: 1200,
      notes: 'rrsp',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('falls unknown kinds and non-numeric money back to safe defaults', () => {
    const now = '2026-11-09T00:00:00.000Z';
    expect(
      mapCloudInvestmentAccount(
        'bad',
        { name: 12, kind: 'hedge-fund', contributedUsd: '1000', valueUsd: NaN, notes: null },
        now,
      ),
    ).toEqual({
      id: 'bad',
      name: '',
      kind: 'other',
      contributedUsd: 0,
      valueUsd: 0,
      notes: undefined,
      createdAt: now,
      updatedAt: now,
    });
  });

  it('lists every kind the apps persist', () => {
    expect(INVESTMENT_KINDS).toEqual(['stocks', 'etf', 'crypto', 'retirement', 'savings', 'other']);
  });
});

describe('mapCloudInvestmentSnapshot', () => {
  it('drops non-numeric values so a bad cloud row cannot poison charts', () => {
    expect(
      mapCloudInvestmentSnapshot('s1', {
        accountId: 'a1',
        date: '2026-02-01',
        valueUsd: Infinity,
        contributedUsd: undefined,
        createdAt: 'c',
      }),
    ).toEqual({
      id: 's1',
      accountId: 'a1',
      date: '2026-02-01',
      valueUsd: 0,
      contributedUsd: 0,
      createdAt: 'c',
    });
  });
});
