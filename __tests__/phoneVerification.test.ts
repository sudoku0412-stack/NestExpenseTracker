const mockSignInWithPhoneNumber = jest.fn();
const mockCredential = jest.fn();

jest.mock('@react-native-firebase/auth', () => {
  const authFn = () => ({
    signInWithPhoneNumber: (...args: unknown[]) => mockSignInWithPhoneNumber(...args),
  });
  authFn.PhoneAuthProvider = { credential: (...args: unknown[]) => mockCredential(...args) };
  return { __esModule: true, default: authFn };
});

const mockGetCurrentUser = jest.fn();

jest.mock('../lib/auth', () => ({
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
}));

const mockSetProfilePhone = jest.fn();

jest.mock('../lib/profile', () => ({
  setProfilePhone: (...args: unknown[]) => mockSetProfilePhone(...args),
}));

const mockSyncPhoneToCloud = jest.fn();
const mockSetPhoneIndex = jest.fn();
const mockClearPhoneIndex = jest.fn();
const mockAcceptPhoneInviteIfAny = jest.fn();

jest.mock('../lib/cloudSync', () => ({
  syncPhoneToCloud: (...args: unknown[]) => mockSyncPhoneToCloud(...args),
  setPhoneIndex: (...args: unknown[]) => mockSetPhoneIndex(...args),
  clearPhoneIndex: (...args: unknown[]) => mockClearPhoneIndex(...args),
  acceptPhoneInviteIfAny: (...args: unknown[]) => mockAcceptPhoneInviteIfAny(...args),
}));

import {
  startPhoneVerification,
  confirmPhoneVerification,
  setPhoneNumberManual,
  removePhoneVerification,
  isPhoneAlreadyInUseError,
} from '../lib/phoneVerification';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isPhoneAlreadyInUseError', () => {
  it('true for the credential-already-in-use code', () => {
    expect(isPhoneAlreadyInUseError({ code: 'auth/credential-already-in-use' })).toBe(true);
  });

  it('false for other codes', () => {
    expect(isPhoneAlreadyInUseError({ code: 'auth/invalid-verification-code' })).toBe(false);
  });

  it('false for null/undefined/non-object input', () => {
    expect(isPhoneAlreadyInUseError(null)).toBe(false);
    expect(isPhoneAlreadyInUseError(undefined)).toBe(false);
    expect(isPhoneAlreadyInUseError('auth/credential-already-in-use')).toBe(false);
    expect(isPhoneAlreadyInUseError(42)).toBe(false);
  });

  it('false for an object with no code field', () => {
    expect(isPhoneAlreadyInUseError({ message: 'oops' })).toBe(false);
  });
});

describe('startPhoneVerification', () => {
  it('throws when not signed in', async () => {
    mockGetCurrentUser.mockReturnValue(null);
    await expect(startPhoneVerification('+14165551234')).rejects.toThrow('Not signed in.');
  });

  it('signs in via signInWithPhoneNumber when signed in', async () => {
    mockGetCurrentUser.mockReturnValue({ uid: 'u1' });
    mockSignInWithPhoneNumber.mockResolvedValue({ verificationId: 'vid-1' });
    const result = await startPhoneVerification('+14165551234');
    expect(result).toEqual({ verificationId: 'vid-1' });
    expect(mockSignInWithPhoneNumber).toHaveBeenCalledWith('+14165551234');
  });
});

describe('confirmPhoneVerification', () => {
  const confirmation = { verificationId: 'vid-1' } as never;

  it('throws when not signed in', async () => {
    mockGetCurrentUser.mockReturnValue(null);
    await expect(confirmPhoneVerification(confirmation, '123456')).rejects.toThrow('Not signed in.');
  });

  it('throws when verificationId is falsy', async () => {
    mockGetCurrentUser.mockReturnValue({ uid: 'u1', linkWithCredential: jest.fn() });
    await expect(
      confirmPhoneVerification({ verificationId: '' } as never, '123456'),
    ).rejects.toThrow('Verification expired');
  });

  it('links, syncs, indexes and returns joinedHouseholdId when an invite auto-joins', async () => {
    const linkWithCredential = jest.fn().mockResolvedValue({
      user: { uid: 'u1', phoneNumber: '+14165551234' },
    });
    mockGetCurrentUser.mockReturnValue({ uid: 'u1', linkWithCredential });
    mockCredential.mockReturnValue({ mock: 'cred' });
    mockAcceptPhoneInviteIfAny.mockResolvedValue({ joined: true, householdId: 'h1' });

    const result = await confirmPhoneVerification(confirmation, '123456');

    expect(mockCredential).toHaveBeenCalledWith('vid-1', '123456');
    expect(linkWithCredential).toHaveBeenCalledWith({ mock: 'cred' });
    expect(mockSetProfilePhone).toHaveBeenCalledWith('u1', '+14165551234', true);
    expect(mockSyncPhoneToCloud).toHaveBeenCalledWith('u1', '+14165551234', true);
    expect(mockSetPhoneIndex).toHaveBeenCalledWith('u1', '+14165551234');
    expect(result).toEqual({ joinedHouseholdId: 'h1' });
  });

  it('returns {} when no invite is pending', async () => {
    const linkWithCredential = jest.fn().mockResolvedValue({
      user: { uid: 'u1', phoneNumber: '+14165551234' },
    });
    mockGetCurrentUser.mockReturnValue({ uid: 'u1', linkWithCredential });
    mockAcceptPhoneInviteIfAny.mockResolvedValue({ joined: false });

    const result = await confirmPhoneVerification(confirmation, '123456');
    expect(result).toEqual({});
  });

  it('trims whitespace on the SMS code before building the credential', async () => {
    const linkWithCredential = jest.fn().mockResolvedValue({
      user: { uid: 'u1', phoneNumber: '+14165551234' },
    });
    mockGetCurrentUser.mockReturnValue({ uid: 'u1', linkWithCredential });
    mockCredential.mockReturnValue({ mock: 'cred' });
    mockAcceptPhoneInviteIfAny.mockResolvedValue({ joined: false });

    await confirmPhoneVerification(confirmation, '  123456\n');
    expect(mockCredential).toHaveBeenCalledWith('vid-1', '123456');
  });

  it('skips phone-index/invite steps when the linked user has no phone number', async () => {
    const linkWithCredential = jest.fn().mockResolvedValue({
      user: { uid: 'u1', phoneNumber: null },
    });
    mockGetCurrentUser.mockReturnValue({ uid: 'u1', linkWithCredential });

    const result = await confirmPhoneVerification(confirmation, '123456');
    expect(result).toEqual({});
    expect(mockSetPhoneIndex).not.toHaveBeenCalled();
    expect(mockAcceptPhoneInviteIfAny).not.toHaveBeenCalled();
  });
});

describe('setPhoneNumberManual', () => {
  it('sets profile phone, syncs, indexes, and returns joinedHouseholdId on match', async () => {
    mockAcceptPhoneInviteIfAny.mockResolvedValue({ joined: true, householdId: 'h2' });
    const result = await setPhoneNumberManual('u1', '+14165551234');
    expect(mockSetProfilePhone).toHaveBeenCalledWith('u1', '+14165551234', true);
    expect(mockSyncPhoneToCloud).toHaveBeenCalledWith('u1', '+14165551234', true);
    expect(mockSetPhoneIndex).toHaveBeenCalledWith('u1', '+14165551234');
    expect(result).toEqual({ joinedHouseholdId: 'h2' });
  });

  it('returns {} when no invite matches', async () => {
    mockAcceptPhoneInviteIfAny.mockResolvedValue({ joined: false });
    const result = await setPhoneNumberManual('u1', '+14165551234');
    expect(result).toEqual({});
  });
});

describe('removePhoneVerification', () => {
  it('clears profile phone, syncs, and clears the phone index when a previous phone existed', async () => {
    await removePhoneVerification('u1', '+14165551234');
    expect(mockSetProfilePhone).toHaveBeenCalledWith('u1', null, false);
    expect(mockSyncPhoneToCloud).toHaveBeenCalledWith('u1', null, false);
    expect(mockClearPhoneIndex).toHaveBeenCalledWith('+14165551234');
  });

  it('skips clearing the phone index when there was no previous phone', async () => {
    await removePhoneVerification('u1', null);
    expect(mockClearPhoneIndex).not.toHaveBeenCalled();
  });
});
