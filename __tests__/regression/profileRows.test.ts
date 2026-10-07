/**
 * Profile SQLite rows are the source of truth for phone-verified
 * household invites. ON CONFLICT must refresh name/phone without
 * rewriting created_at, and DELETE must be uid-scoped so an account
 * wipe cannot drop another profile on a shared device.
 */

type ProfileRow = {
  uid: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  phone_verified: number | null;
  created_at: string;
  updated_at: string;
};

const mockProfiles = new Map<string, ProfileRow>();

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async () => []),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
    getFirstAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (!/FROM profiles WHERE uid=\?/i.test(sql)) return null;
      return mockProfiles.get(params[0] as string) ?? null;
    }),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO profiles/i.test(sql)) {
        if (/ON CONFLICT/i.test(sql)) {
          expect(sql).not.toMatch(/created_at\s*=\s*excluded/i);
        }
        const incoming: ProfileRow = {
          uid: params[0] as string,
          first_name: params[1] as string,
          last_name: params[2] as string,
          phone: (params[3] as string | null) ?? null,
          phone_verified: (params[4] as number | null) ?? null,
          created_at: params[5] as string,
          updated_at: params[6] as string,
        };
        const existing = mockProfiles.get(incoming.uid);
        if (existing) {
          // Matches production ON CONFLICT: created_at is omitted from
          // the UPDATE list so the original signup timestamp sticks.
          mockProfiles.set(incoming.uid, {
            ...incoming,
            created_at: existing.created_at,
          });
        } else {
          mockProfiles.set(incoming.uid, incoming);
        }
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (/DELETE FROM profiles WHERE uid=\?/i.test(sql)) {
        mockProfiles.delete(params[0] as string);
        return { lastInsertRowId: 0, changes: 1 };
      }
      return { lastInsertRowId: 0, changes: 0 };
    }),
  }),
}));

jest.mock('../../lib/cloudSync', () => ({
  syncReceiptDeletionToCloud: jest.fn(),
  syncReceiptToCloud: jest.fn(),
  syncSettlementToCloud: jest.fn(),
  syncIncomeToCloud: jest.fn(),
  syncIncomeDeletionToCloud: jest.fn(),
  syncSavingsGoalToCloud: jest.fn(),
  syncSavingsGoalDeletionToCloud: jest.fn(),
  uploadReceiptPhoto: jest.fn(),
}));

import {
  deleteProfileRow,
  getProfileRow,
  upsertProfileRow,
} from '../../lib/database';

function row(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    uid: 'u1',
    first_name: 'Ada',
    last_name: 'Lovelace',
    phone: '+15551212',
    phone_verified: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockProfiles.clear();
});

describe('profile SQLite rows', () => {
  it('inserts then reads back by uid', async () => {
    await upsertProfileRow(row());
    await expect(getProfileRow('u1')).resolves.toMatchObject({
      first_name: 'Ada',
      phone: '+15551212',
      phone_verified: 1,
    });
    await expect(getProfileRow('u2')).resolves.toBeNull();
  });

  it('ON CONFLICT updates name/phone/updated_at but never created_at', async () => {
    await upsertProfileRow(row());
    await upsertProfileRow(
      row({
        first_name: 'Ada',
        last_name: 'Byron',
        phone: null,
        phone_verified: 0,
        created_at: '2099-01-01T00:00:00.000Z',
        updated_at: '2026-06-01T00:00:00.000Z',
      }),
    );
    const saved = await getProfileRow('u1');
    expect(saved).toMatchObject({
      last_name: 'Byron',
      phone: null,
      phone_verified: 0,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    });
  });

  it('deleteProfileRow only removes the named uid', async () => {
    await upsertProfileRow(row());
    await upsertProfileRow(row({ uid: 'u2', first_name: 'Other' }));
    await deleteProfileRow('u1');
    await expect(getProfileRow('u1')).resolves.toBeNull();
    await expect(getProfileRow('u2')).resolves.toMatchObject({ first_name: 'Other' });
  });
});
