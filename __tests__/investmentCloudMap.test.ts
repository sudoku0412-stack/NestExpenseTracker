import { mapInvestmentAccountFromCloud, mapInvestmentSnapshotFromCloud } from '../lib/investmentCloudMap';

const NOW = '2026-11-16T13:00:00.000Z';

describe('mapInvestmentAccountFromCloud', () => {
  it('copies a well-formed account', () => {
    expect(
      mapInvestmentAccountFromCloud(
        'a1',
        {
          name: 'TFSA',
          kind: 'etf',
          contributedUsd: 1000,
          valueUsd: 1200,
          notes: 'hold',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
        },
        NOW,
      ),
    ).toEqual({
      id: 'a1',
      name: 'TFSA',
      kind: 'etf',
      contributedUsd: 1000,
      valueUsd: 1200,
      notes: 'hold',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('falls unknown kinds to other, missing numbers to 0, and missing timestamps to now', () => {
    expect(mapInvestmentAccountFromCloud('a2', { kind: 'hedge-fund' }, NOW)).toEqual({
      id: 'a2',
      name: '',
      kind: 'other',
      contributedUsd: 0,
      valueUsd: 0,
      notes: undefined,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('treats null notes as unset so the local type stays optional', () => {
    expect(mapInvestmentAccountFromCloud('a3', { name: 'RRSP', kind: 'retirement', notes: null }, NOW).notes).toBeUndefined();
  });
});

describe('mapInvestmentSnapshotFromCloud', () => {
  it('requires an accountId and date, defaulting amounts to 0', () => {
    expect(mapInvestmentSnapshotFromCloud('s1', { accountId: 'a1', date: '2026-02-01' }, NOW)).toEqual({
      id: 's1',
      accountId: 'a1',
      date: '2026-02-01',
      valueUsd: 0,
      contributedUsd: 0,
      createdAt: NOW,
    });
  });
});
