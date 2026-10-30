const mockUpdateProfile = jest.fn();
const mockSignInAnonymously = jest.fn();
const mockSignInWithEmailAndPassword = jest.fn();
const mockCreateUserWithEmailAndPassword = jest.fn();
const mockSignInWithPhoneNumber = jest.fn();
const mockSignInWithCredential = jest.fn();
const mockSignOut = jest.fn();
const mockSendPasswordResetEmail = jest.fn();
const mockCredentialFn = jest.fn();
const mockAppleCredentialFn = jest.fn();

let mockCurrentUser: {
  updateProfile?: jest.Mock;
  delete?: jest.Mock;
  reload?: jest.Mock;
  providerData?: Array<{ providerId: string }>;
} | null = null;

jest.mock('@react-native-firebase/auth', () => {
  const authFn = () => ({
    get currentUser() {
      return mockCurrentUser;
    },
    signInAnonymously: (...args: unknown[]) => mockSignInAnonymously(...args),
    signInWithEmailAndPassword: (...args: unknown[]) => mockSignInWithEmailAndPassword(...args),
    createUserWithEmailAndPassword: (...args: unknown[]) =>
      mockCreateUserWithEmailAndPassword(...args),
    signInWithPhoneNumber: (...args: unknown[]) => mockSignInWithPhoneNumber(...args),
    signInWithCredential: (...args: unknown[]) => mockSignInWithCredential(...args),
    signOut: (...args: unknown[]) => mockSignOut(...args),
    sendPasswordResetEmail: (...args: unknown[]) => mockSendPasswordResetEmail(...args),
  });
  authFn.GoogleAuthProvider = { credential: (...args: unknown[]) => mockCredentialFn(...args) };
  authFn.AppleAuthProvider = { credential: (...args: unknown[]) => mockAppleCredentialFn(...args) };
  return { __esModule: true, default: authFn };
});

const mockAppleSignInAsync = jest.fn();

jest.mock('expo-apple-authentication', () => ({
  signInAsync: (...args: unknown[]) => mockAppleSignInAsync(...args),
  AppleAuthenticationScope: { FULL_NAME: 'FULL_NAME', EMAIL: 'EMAIL' },
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'raw-nonce',
  digestStringAsync: async () => 'hashed-nonce',
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
}));

const mockGoogleSignIn = jest.fn();
const mockGoogleSignOut = jest.fn();
const mockGetCurrentGoogleUser = jest.fn();
const mockHasPreviousSignIn = jest.fn();
const mockHasPlayServices = jest.fn();
let isErrorWithCodeImpl = (e: unknown): e is { code: string } =>
  typeof e === 'object' && e !== null && 'code' in e;
let isSuccessResponseImpl = (r: unknown): boolean => (r as { type?: string })?.type === 'success';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    hasPlayServices: (...args: unknown[]) => mockHasPlayServices(...args),
    signIn: (...args: unknown[]) => mockGoogleSignIn(...args),
    signOut: (...args: unknown[]) => mockGoogleSignOut(...args),
    getCurrentUser: (...args: unknown[]) => mockGetCurrentGoogleUser(...args),
    hasPreviousSignIn: (...args: unknown[]) => mockHasPreviousSignIn(...args),
    configure: jest.fn(),
  },
  isErrorWithCode: (e: unknown) => isErrorWithCodeImpl(e),
  isSuccessResponse: (r: unknown) => isSuccessResponseImpl(r),
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));

import {
  updateAuthDisplayName,
  signInWithGoogle,
  signInWithApple,
  deleteCurrentAccount,
  hasGoogleProvider,
  sendPasswordReset,
  signOutEverywhere,
  signInWithEmail,
  signUpWithEmail,
  signInAsGuest,
  signInWithPhone,
  confirmPhoneCode,
  reloadCurrentUser,
} from '../lib/auth';

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = null;
  mockHasPlayServices.mockResolvedValue(true);
  mockHasPreviousSignIn.mockReturnValue(false);
  mockGetCurrentGoogleUser.mockResolvedValue(null);
  mockSignOut.mockResolvedValue(undefined);
  mockSendPasswordResetEmail.mockResolvedValue(undefined);
  mockGoogleSignOut.mockResolvedValue(undefined);
  isErrorWithCodeImpl = (e: unknown): e is { code: string } =>
    typeof e === 'object' && e !== null && 'code' in e;
  isSuccessResponseImpl = (r: unknown): boolean => (r as { type?: string })?.type === 'success';
});

describe('email / guest / phone sign-in', () => {
  it('signInWithEmail trims the email before calling Firebase', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u1' } });
    const user = await signInWithEmail('  jane@example.com  ', 'secret');
    expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith('jane@example.com', 'secret');
    expect(user).toEqual({ uid: 'u1' });
  });

  it('signUpWithEmail trims the email before calling Firebase', async () => {
    mockCreateUserWithEmailAndPassword.mockResolvedValue({ user: { uid: 'u2' } });
    const user = await signUpWithEmail('  New@Example.COM ', 'secret');
    expect(mockCreateUserWithEmailAndPassword).toHaveBeenCalledWith('New@Example.COM', 'secret');
    expect(user).toEqual({ uid: 'u2' });
  });

  it('signInAsGuest returns the anonymous user', async () => {
    mockSignInAnonymously.mockResolvedValue({ user: { uid: 'anon' } });
    await expect(signInAsGuest()).resolves.toEqual({ uid: 'anon' });
  });

  it('signInWithPhone trims the number', async () => {
    mockSignInWithPhoneNumber.mockResolvedValue({ verificationId: 'vid' });
    await expect(signInWithPhone('  +14165551234  ')).resolves.toEqual({ verificationId: 'vid' });
    expect(mockSignInWithPhoneNumber).toHaveBeenCalledWith('+14165551234');
  });

  it('confirmPhoneCode trims the SMS code and returns the user', async () => {
    const confirm = jest.fn().mockResolvedValue({ user: { uid: 'u3' } });
    await expect(confirmPhoneCode({ confirm } as never, '  123456  ')).resolves.toEqual({
      uid: 'u3',
    });
    expect(confirm).toHaveBeenCalledWith('123456');
  });

  it('confirmPhoneCode throws when Firebase returns no user', async () => {
    const confirm = jest.fn().mockResolvedValue({ user: null });
    await expect(confirmPhoneCode({ confirm } as never, '123456')).rejects.toThrow(
      'Phone confirmation failed.',
    );
  });
});

describe('reloadCurrentUser', () => {
  it('returns null when nobody is signed in', async () => {
    mockCurrentUser = null;
    await expect(reloadCurrentUser()).resolves.toBeNull();
  });

  it('reloads the current user and returns the post-reload snapshot', async () => {
    const reload = jest.fn().mockImplementation(async () => {
      mockCurrentUser = { updateProfile: mockUpdateProfile, providerData: [] };
    });
    mockCurrentUser = { updateProfile: mockUpdateProfile, reload };
    const result = await reloadCurrentUser();
    expect(reload).toHaveBeenCalled();
    expect(result).toBe(mockCurrentUser);
  });
});

describe('updateAuthDisplayName', () => {
  it('no-ops when not signed in', async () => {
    mockCurrentUser = null;
    await updateAuthDisplayName('New Name');
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('no-ops when displayName is blank/whitespace-only', async () => {
    mockCurrentUser = { updateProfile: mockUpdateProfile };
    await updateAuthDisplayName('   ');
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('calls updateProfile with the trimmed name otherwise', async () => {
    mockCurrentUser = { updateProfile: mockUpdateProfile };
    await updateAuthDisplayName('  Jane Doe  ');
    expect(mockUpdateProfile).toHaveBeenCalledWith({ displayName: 'Jane Doe' });
  });
});

describe('signInWithGoogle', () => {
  it('throws a normalized SIGN_IN_CANCELLED error when GoogleSignin.signIn throws a cancelled-code error', async () => {
    mockGoogleSignIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED' });
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'SIGN_IN_CANCELLED' });
  });

  it('rethrows other errors from GoogleSignin.signIn unchanged', async () => {
    mockGoogleSignIn.mockRejectedValue({ code: 'SOME_OTHER_ERROR' });
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'SOME_OTHER_ERROR' });
  });

  it('throws SIGN_IN_CANCELLED when the response is not a success response', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'cancelled' });
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'SIGN_IN_CANCELLED' });
  });

  it('throws when no idToken is returned on an otherwise-successful response', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'success', data: {} });
    await expect(signInWithGoogle()).rejects.toThrow('No Google ID token returned.');
  });

  it('signs in with the credential when a valid idToken is returned', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'tok-123' } });
    mockCredentialFn.mockReturnValue({ mock: 'cred' });
    mockSignInWithCredential.mockResolvedValue({ user: { uid: 'u1' } });
    const user = await signInWithGoogle();
    expect(mockCredentialFn).toHaveBeenCalledWith('tok-123');
    expect(user).toEqual({ uid: 'u1' });
  });
});

describe('signInWithApple', () => {
  it('throws when no identityToken is returned', async () => {
    mockAppleSignInAsync.mockResolvedValue({ identityToken: null });
    await expect(signInWithApple()).rejects.toThrow('No Apple identity token returned.');
  });

  it('signs in with the credential using the raw (unhashed) nonce', async () => {
    mockAppleSignInAsync.mockResolvedValue({ identityToken: 'tok-123', fullName: null });
    mockAppleCredentialFn.mockReturnValue({ mock: 'cred' });
    mockSignInWithCredential.mockResolvedValue({ user: { uid: 'u1', displayName: null } });
    await signInWithApple();
    expect(mockAppleSignInAsync).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 'hashed-nonce' }),
    );
    expect(mockAppleCredentialFn).toHaveBeenCalledWith('tok-123', 'raw-nonce');
  });

  it('sets displayName from fullName on first sign-in (no existing displayName)', async () => {
    const updateProfile = jest.fn().mockResolvedValue(undefined);
    mockAppleSignInAsync.mockResolvedValue({
      identityToken: 'tok-123',
      fullName: { givenName: 'Jane', familyName: 'Doe' },
    });
    mockSignInWithCredential.mockResolvedValue({
      user: { uid: 'u1', displayName: null, updateProfile },
    });
    await signInWithApple();
    expect(updateProfile).toHaveBeenCalledWith({ displayName: 'Jane Doe' });
  });

  it('does not touch displayName on later sign-ins (Apple omits fullName)', async () => {
    const updateProfile = jest.fn();
    mockAppleSignInAsync.mockResolvedValue({ identityToken: 'tok-123', fullName: null });
    mockSignInWithCredential.mockResolvedValue({
      user: { uid: 'u1', displayName: null, updateProfile },
    });
    await signInWithApple();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('propagates cancellation (ERR_REQUEST_CANCELED) unchanged', async () => {
    mockAppleSignInAsync.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
    await expect(signInWithApple()).rejects.toMatchObject({ code: 'ERR_REQUEST_CANCELED' });
  });
});

describe('deleteCurrentAccount', () => {
  it('throws when not signed in', async () => {
    mockCurrentUser = null;
    await expect(deleteCurrentAccount()).rejects.toThrow('Not signed in.');
  });

  it('deletes the account even when Google sign-out throws (best-effort)', async () => {
    const deleteFn = jest.fn().mockResolvedValue(undefined);
    mockCurrentUser = { delete: deleteFn, providerData: [{ providerId: 'google.com' }] };
    mockGoogleSignOut.mockRejectedValue(new Error('google unavailable'));
    await expect(deleteCurrentAccount()).resolves.toBeUndefined();
    expect(deleteFn).toHaveBeenCalled();
  });

  it('signs out of Google first when a Google user is present', async () => {
    const deleteFn = jest.fn().mockResolvedValue(undefined);
    mockCurrentUser = { delete: deleteFn, providerData: [{ providerId: 'google.com' }] };
    mockGoogleSignOut.mockResolvedValue(undefined);
    await deleteCurrentAccount();
    expect(mockGoogleSignOut).toHaveBeenCalled();
    expect(deleteFn).toHaveBeenCalled();
  });

  it('does not call Google native APIs when deleting a non-Google account', async () => {
    const deleteFn = jest.fn().mockResolvedValue(undefined);
    mockCurrentUser = { delete: deleteFn, providerData: [{ providerId: 'apple.com' }] };
    await deleteCurrentAccount();
    expect(mockGoogleSignOut).not.toHaveBeenCalled();
    expect(mockGetCurrentGoogleUser).not.toHaveBeenCalled();
    expect(mockHasPreviousSignIn).not.toHaveBeenCalled();
    expect(deleteFn).toHaveBeenCalled();
  });
});

describe('hasGoogleProvider', () => {
  it('is true only for google.com providerData', () => {
    expect(hasGoogleProvider({ providerData: [{ providerId: 'google.com' }] })).toBe(true);
    expect(hasGoogleProvider({ providerData: [{ providerId: 'apple.com' }] })).toBe(false);
    expect(hasGoogleProvider({ providerData: [] })).toBe(false);
    expect(hasGoogleProvider(null)).toBe(false);
  });
});

describe('signOutEverywhere', () => {
  it('signs out of firebase without touching Google native APIs by default', async () => {
    await expect(signOutEverywhere()).resolves.toBeUndefined();
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockGoogleSignOut).not.toHaveBeenCalled();
    expect(mockGetCurrentGoogleUser).not.toHaveBeenCalled();
    expect(mockHasPreviousSignIn).not.toHaveBeenCalled();
  });

  it('fires Google signOut only when google:true, and does not wait if it hangs', async () => {
    mockGoogleSignOut.mockImplementation(() => new Promise(() => {}));
    await expect(signOutEverywhere({ google: true })).resolves.toBeUndefined();
    expect(mockGoogleSignOut).toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockHasPreviousSignIn).not.toHaveBeenCalled();
    expect(mockGetCurrentGoogleUser).not.toHaveBeenCalled();
  });

  it('resolves even when Firebase sign-out never settles', async () => {
    jest.useFakeTimers();
    try {
      mockSignOut.mockImplementation(() => new Promise(() => {}));
      const pending = signOutEverywhere();
      await jest.advanceTimersByTimeAsync(4000);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('sendPasswordReset', () => {
  it('sends a handleCodeInApp deep link back into this app, not the hosted web page', async () => {
    await sendPasswordReset('  jane@example.com  ');
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith(
      'jane@example.com',
      expect.objectContaining({
        url: 'https://balancesheet-android.web.app/reset-password',
        handleCodeInApp: true,
        android: expect.objectContaining({
          packageName: 'com.kaushikmajumder.receiptscanner',
        }),
        iOS: expect.objectContaining({
          bundleId: 'com.kaushikmajumder.receiptscanner',
        }),
      }),
    );
  });
});
