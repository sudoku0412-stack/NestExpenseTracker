import {
  mapInvestmentAccountFromCloud,
  mapInvestmentSnapshotFromCloud,
  missingCloudIds,
  serializeInvestmentAccount,
  serializeInvestmentSnapshot,
} from '../lib/investmentCloud';
import type { InvestmentAccount, InvestmentSnapshot } from '../types';

const NOW = '2026-11-21T13:00:00.000Z';

describe('mapInvestmentAccountFromCloud', () => {
  it('maps a well-formed personal holding and keeps the doc id', () => {
    expect(mapInvestmentAccountFromCloud('a1', {
      name: 'TFSA',
      kind: 'etf',
      contributedUsd: 1000,
      valueUsd: 1200,
      notes: 'rrsp',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    }, NOW)).toEqual({
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

  it('treats an unknown kind as other and zero-fills missing amounts', () => {
    expect(mapInvestmentAccountFromCloud('x', { kind: 'hedge-fund' }, NOW)).toMatchObject({
      id: 'x',
      name: '',
      kind: 'other',
      contributedUsd: 0,
      valueUsd: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('coerces NaN and 0 amounts to 0, and drops a null notes field', () => {
    const a = mapInvestmentAccountFromCloud('x', {
      name: 'Cash',
      kind: 'savings',
      contributedUsd: Number.NaN,
      valueUsd: 0,
      notes: null,
    }, NOW);
    expect(a.contributedUsd).toBe(0);
    expect(a.valueUsd).toBe(0);
    expect(a.notes).toBeUndefined();
  });
});

describe('mapInvestmentSnapshotFromCloud', () => {
  it('maps a snapshot and fills missing ids/dates', () => {
    expect(mapInvestmentSnapshotFromCloud('s1', {
      accountId: 'a1',
      date: '2026-04-01',
      valueUsd: 99,
      contributedUsd: 80,
      createdAt: 'c',
    }, NOW)).toEqual({
      id: 's1',
      accountId: 'a1',
      date: '2026-04-01',
      valueUsd: 99,
      contributedUsd: 80,
      createdAt: 'c',
    });
    expect(mapInvestmentSnapshotFromCloud('s2', {}, NOW)).toEqual({
      id: 's2',
      accountId: '',
      date: '',
      valueUsd: 0,
      contributedUsd: 0,
      createdAt: NOW,
    });
  });
});

describe('serializeInvestmentAccount / serializeInvestmentSnapshot', () => {
  it('writes the account body without an id (the Firestore doc id is the id) and null notes', () => {
    const account: InvestmentAccount = {
      id: 'a1',
      name: 'TFSA',
      kind: 'etf',
      contributedUsd: 10,
      valueUsd: 12,
      createdAt: 'c',
      updatedAt: 'u',
    };
    expect(serializeInvestmentAccount(account)).toEqual({
      name: 'TFSA',
      kind: 'etf',
      contributedUsd: 10,
      valueUsd: 12,
      notes: null,
      createdAt: 'c',
      updatedAt: 'u',
    });
    expect(serializeInvestmentAccount({ ...account, notes: 'n' }).notes).toBe('n');
  });

  it('serializes a snapshot without embedding the snapshot id', () => {
    const snap: InvestmentSnapshot = {
      id: 's1',
      accountId: 'a1',
      date: '2026-04-01',
      valueUsd: 12,
      contributedUsd: 10,
      createdAt: 'c',
    };
    expect(serializeInvestmentSnapshot(snap)).toEqual({
      accountId: 'a1',
      date: '2026-04-01',
      valueUsd: 12,
      contributedUsd: 10,
      createdAt: 'c',
    });
  });
});

describe('missingCloudIds', () => {
  it('returns only local ids the cloud does not already have', () => {
    expect(missingCloudIds(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(missingCloudIds([], ['z'])).toEqual([]);
    expect(missingCloudIds(['a'], [])).toEqual(['a']);
  });
});
