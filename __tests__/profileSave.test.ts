/**
 * lib/profile.ts sits between name-edit / OTP flows and SQLite.
 * Validation is already unit-tested; these cover the mapping and
 * write contracts that phoneVerification + AuthContext depend on:
 * a name save must not wipe a verified phone, and setProfilePhone
 * must not invent a profile.
 */

const mockGetProfileRow = jest.fn();
const mockUpsertProfileRow = jest.fn();
const mockDeleteProfileRow = jest.fn();

jest.mock('../lib/database', () => ({
  getProfileRow: (...args: unknown[]) => mockGetProfileRow(...args),
  upsertProfileRow: (...args: unknown[]) => mockUpsertProfileRow(...args),
  deleteProfileRow: (...args: unknown[]) => mockDeleteProfileRow(...args),
}));

import {
  deleteProfile,
  getProfile,
  rowToProfile,
  saveProfile,
  setProfilePhone,
} from '../lib/profile';
import type { ProfileRow } from '../lib/database';

const row = (overrides: Partial<ProfileRow> = {}): ProfileRow => ({
  uid: 'u1',
  first_name: 'Jane',
  last_name: 'Doe',
  phone: '+15551212',
  phone_verified: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProfileRow.mockResolvedValue(null);
  mockUpsertProfileRow.mockResolvedValue(undefined);
  mockDeleteProfileRow.mockResolvedValue(undefined);
});

describe('rowToProfile', () => {
  it('treats phone_verified === 1 as verified and anything else as not', () => {
    expect(rowToProfile(row({ phone_verified: 1 })).phoneVerified).toBe(true);
    expect(rowToProfile(row({ phone_verified: 0 })).phoneVerified).toBe(false);
    expect(rowToProfile(row({ phone_verified: null })).phoneVerified).toBe(false);
  });
});

describe('getProfile', () => {
  it('returns null when no row exists', async () => {
    await expect(getProfile('u1')).resolves.toBeNull();
  });

  it('maps a stored row', async () => {
    mockGetProfileRow.mockResolvedValueOnce(row());
    await expect(getProfile('u1')).resolves.toEqual({
      uid: 'u1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+15551212',
      phoneVerified: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
  });
});

describe('saveProfile', () => {
  it('rejects an invalid draft before writing', async () => {
    await expect(
      saveProfile('u1', { firstName: '   ', lastName: 'Doe' }, null),
    ).rejects.toThrow(/invalid/i);
    expect(mockUpsertProfileRow).not.toHaveBeenCalled();
  });

  it('trims names, keeps an existing phone/verified/createdAt, and bumps updatedAt', async () => {
    const existing = rowToProfile(row());
    const saved = await saveProfile(
      'u1',
      { firstName: '  Ada  ', lastName: '  Lovelace  ' },
      existing,
    );
    expect(saved.firstName).toBe('Ada');
    expect(saved.lastName).toBe('Lovelace');
    expect(saved.phone).toBe('+15551212');
    expect(saved.phoneVerified).toBe(true);
    expect(saved.createdAt).toBe(existing.createdAt);
    expect(saved.updatedAt).not.toBe(existing.updatedAt);
    expect(mockUpsertProfileRow).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'u1',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone: '+15551212',
        phone_verified: 1,
        created_at: existing.createdAt,
      }),
    );
  });

  it('creates a new profile without marking the phone verified', async () => {
    const saved = await saveProfile('u1', { firstName: 'Ada', lastName: '' }, null);
    expect(saved.phone).toBeNull();
    expect(saved.phoneVerified).toBe(false);
    expect(saved.createdAt).toBe(saved.updatedAt);
    expect(mockUpsertProfileRow).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: null,
        phone_verified: 0,
      }),
    );
  });
});

describe('setProfilePhone', () => {
  it('throws when there is no local profile to attach the phone to', async () => {
    await expect(setProfilePhone('u1', '+15550000', true)).rejects.toThrow(
      /no profile/i,
    );
    expect(mockUpsertProfileRow).not.toHaveBeenCalled();
  });

  it('writes the phone without changing names or createdAt', async () => {
    mockGetProfileRow.mockResolvedValueOnce(row({ phone: null, phone_verified: 0 }));
    const saved = await setProfilePhone('u1', '+15559999', true);
    expect(saved.phone).toBe('+15559999');
    expect(saved.phoneVerified).toBe(true);
    expect(saved.firstName).toBe('Jane');
    expect(saved.lastName).toBe('Doe');
    expect(saved.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(mockUpsertProfileRow).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'Jane',
        last_name: 'Doe',
        phone: '+15559999',
        phone_verified: 1,
        created_at: '2026-01-01T00:00:00.000Z',
      }),
    );
  });
});

describe('deleteProfile', () => {
  it('deletes only the requested uid row', async () => {
    await deleteProfile('u1');
    expect(mockDeleteProfileRow).toHaveBeenCalledWith('u1');
  });
});
