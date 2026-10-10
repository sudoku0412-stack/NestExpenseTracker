import React from 'react';
import { Pressable, Text } from 'react-native';
import { Alert } from 'react-native';
import { render, waitFor, screen, act, fireEvent } from '@testing-library/react-native';

// NOTE: mocks below build their jest.fn()s inline rather than closing
// over outer consts — same convention as entitlementsContext.test.tsx /
// households.test.tsx: factories run eagerly at first require (via ES
// import hoisting), before an outer `const mock... = jest.fn()` in this
// file would be assigned. References are recovered via the (now-mocked)
// module's exports and reconfigured per-test in beforeEach.

jest.mock('expo-constants', () => ({
  get expoConfig() {
    return { extra: { googleWebClientId: 'web-client-id' } };
  },
}));

const mockRouterPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args), replace: jest.fn(), back: jest.fn() },
}));

jest.mock('../../lib/entitlements', () => ({
  getIsPremium: jest.fn(async () => false),
}));

jest.mock('../../lib/auth', () => ({
  configureGoogleSignIn: jest.fn(),
  deleteCurrentAccount: jest.fn(async () => {}),
  getCurrentUser: jest.fn(() => null),
  hasGoogleProvider: jest.fn(() => false),
  onAuthStateChanged: jest.fn(),
  signOutEverywhere: jest.fn(async () => {}),
  updateAuthDisplayName: jest.fn(async () => {}),
}));

jest.mock('../../lib/profile', () => ({
  getProfile: jest.fn(async () => null),
  deleteProfile: jest.fn(async () => {}),
  saveProfile: jest.fn(async (_uid: string, draft: { firstName: string; lastName: string }) => ({
    uid: _uid,
    firstName: draft.firstName,
    lastName: draft.lastName,
    phone: null,
    phoneVerified: false,
    createdAt: 't',
    updatedAt: 't',
  })),
}));

jest.mock('../../lib/database', () => ({
  bootstrapHouseholdId: jest.fn(async () => {}),
  deleteAllReceipts: jest.fn(async () => {}),
  getAllReceipts: jest.fn(async () => []),
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
  setCurrentHouseholdId: jest.fn(),
  setCurrentUserId: jest.fn(async () => {}),
}));

jest.mock('../../lib/cloudSync', () => ({
  acceptInvite: jest.fn(async () => ({ ok: true, newHouseholdId: 'hh-invite' })),
  acceptPhoneInviteIfAny: jest.fn(async () => ({ joined: false })),
  declineInvite: jest.fn(async () => {}),
  deleteCloudUserData: jest.fn(async () => {}),
  ensureHouseholdForUser: jest.fn(async () => 'hh1'),
  ensureMembershipForCurrentHousehold: jest.fn(async () => {}),
  getPendingInviteForEmail: jest.fn(async () => null),
  getUserMemberships: jest.fn(async () => []),
  migrateLocalReceiptsToCloud: jest.fn(async () => {}),
  persistActiveHouseholdId: jest.fn(async () => {}),
  subscribeToHouseholdBudgets: jest.fn(() => jest.fn()),
  subscribeToHouseholdReceipts: jest.fn(() => jest.fn()),
  subscribeToHouseholdSettlements: jest.fn(() => jest.fn()),
  subscribeToHouseholdIncomes: jest.fn(() => jest.fn()),
  subscribeToHouseholdSavingsGoals: jest.fn(() => jest.fn()),
  subscribeToInvestments: jest.fn(() => jest.fn()),
  subscribeToPendingInvite: jest.fn(() => jest.fn()),
  subscribeToPhoneInvite: jest.fn(() => jest.fn()),
  syncPushTokenToCloud: jest.fn(async () => {}),
  setEmailIndex: jest.fn(async () => {}),
  setPhoneIndex: jest.fn(async () => {}),
}));

const mockSetWhatsNewSeen = jest.fn(async (_v: string) => {});
jest.mock('../../lib/secureStorage', () => ({
  setWhatsNewSeenVersion: (v: string) => mockSetWhatsNewSeen(v),
  getOnboardingSeen: jest.fn(async () => false),
  migrateLegacyBudgetsToHousehold: jest.fn(async () => {}),
  setOnboardingSeen: jest.fn(async () => {}),
  resetAllSecureStorage: jest.fn(async () => {}),
}));

jest.mock('../../lib/recurring', () => ({
  processRecurringIncomes: jest.fn(async () => {}),
  processRecurringReceipts: jest.fn(async () => {}),
}));

jest.mock('../../lib/notifications', () => ({
  registerForPushNotificationsAsync: jest.fn(async () => null),
}));

jest.mock('../../lib/dataSync', () => ({
  notifyLocalDataChanged: jest.fn(),
}));

import { AuthProvider, useAuth } from '../../lib/AuthContext';
import {
  configureGoogleSignIn,
  deleteCurrentAccount,
  getCurrentUser,
  hasGoogleProvider,
  onAuthStateChanged,
  signOutEverywhere,
  updateAuthDisplayName,
} from '../../lib/auth';
import { IOS_ALERT_SETTLE_MS, NATIVE_SIGNOUT_DEFER_MS } from '../../lib/signOutTiming';
import { getProfile, deleteProfile, saveProfile } from '../../lib/profile';
import {
  bootstrapHouseholdId,
  deleteAllReceipts,
  getCurrentHouseholdId,
  setCurrentHouseholdId,
  setCurrentUserId,
} from '../../lib/database';
import {
  acceptInvite,
  acceptPhoneInviteIfAny,
  deleteCloudUserData,
  ensureHouseholdForUser,
  ensureMembershipForCurrentHousehold,
  getUserMemberships,
  persistActiveHouseholdId,
  subscribeToHouseholdReceipts,
  subscribeToHouseholdSettlements,
  subscribeToHouseholdIncomes,
  subscribeToHouseholdSavingsGoals,
  subscribeToInvestments,
  subscribeToHouseholdBudgets,
  subscribeToPendingInvite,
  setEmailIndex,
  setPhoneIndex,
} from '../../lib/cloudSync';
import { getIsPremium } from '../../lib/entitlements';
import { processRecurringIncomes, processRecurringReceipts } from '../../lib/recurring';
import { resetAllSecureStorage, setOnboardingSeen } from '../../lib/secureStorage';
import { notifyLocalDataChanged } from '../../lib/dataSync';

const mockOnAuthStateChanged = onAuthStateChanged as jest.Mock;
const mockGetCurrentUser = getCurrentUser as jest.Mock;
const mockConfigureGoogleSignIn = configureGoogleSignIn as jest.Mock;
const mockDeleteCurrentAccount = deleteCurrentAccount as jest.Mock;
const mockSignOutEverywhere = signOutEverywhere as jest.Mock;
const mockHasGoogleProvider = hasGoogleProvider as jest.Mock;
const mockUpdateAuthDisplayName = updateAuthDisplayName as jest.Mock;
const mockGetProfile = getProfile as jest.Mock;
const mockDeleteProfile = deleteProfile as jest.Mock;
const mockSaveProfile = saveProfile as jest.Mock;
const mockBootstrapHouseholdId = bootstrapHouseholdId as jest.Mock;
const mockDeleteAllReceipts = deleteAllReceipts as jest.Mock;
const mockGetCurrentHouseholdId = getCurrentHouseholdId as jest.Mock;
const mockSetCurrentHouseholdId = setCurrentHouseholdId as jest.Mock;
const mockSetCurrentUserId = setCurrentUserId as jest.Mock;
const mockAcceptInvite = acceptInvite as jest.Mock;
const mockAcceptPhoneInviteIfAny = acceptPhoneInviteIfAny as jest.Mock;
const mockDeleteCloudUserData = deleteCloudUserData as jest.Mock;
const mockEnsureHouseholdForUser = ensureHouseholdForUser as jest.Mock;
const mockEnsureMembership = ensureMembershipForCurrentHousehold as jest.Mock;
const mockGetUserMemberships = getUserMemberships as jest.Mock;
const mockPersistActiveHouseholdId = persistActiveHouseholdId as jest.Mock;
const mockSubscribeToHouseholdReceipts = subscribeToHouseholdReceipts as jest.Mock;
const mockSubscribeToHouseholdSettlements = subscribeToHouseholdSettlements as jest.Mock;
const mockSubscribeToHouseholdIncomes = subscribeToHouseholdIncomes as jest.Mock;
const mockSubscribeToHouseholdSavingsGoals = subscribeToHouseholdSavingsGoals as jest.Mock;
const mockSubscribeToInvestments = subscribeToInvestments as jest.Mock;
const mockSubscribeToHouseholdBudgets = subscribeToHouseholdBudgets as jest.Mock;
const mockSubscribeToPendingInvite = subscribeToPendingInvite as jest.Mock;
const mockSetEmailIndex = setEmailIndex as jest.Mock;
const mockSetPhoneIndex = setPhoneIndex as jest.Mock;
const mockGetIsPremium = getIsPremium as jest.Mock;
const mockProcessRecurringIncomes = processRecurringIncomes as jest.Mock;
const mockProcessRecurringReceipts = processRecurringReceipts as jest.Mock;
const mockResetAllSecureStorage = resetAllSecureStorage as jest.Mock;
const mockSetOnboardingSeen = setOnboardingSeen as jest.Mock;
const mockNotifyLocalDataChanged = notifyLocalDataChanged as jest.Mock;

type AuthCb = (user: any) => void | Promise<void>;
let authCb: AuthCb = () => {};

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'u1',
    email: 'jane@example.com',
    emailVerified: true,
    displayName: 'Jane Doe',
    phoneNumber: null,
    ...overrides,
  };
}

function Consumer() {
  const a = useAuth();
  return (
    <>
      <Text testID="initializing">{String(a.initializing)}</Text>
      <Text testID="uid">{a.user?.uid ?? 'none'}</Text>
      <Text testID="profile">{a.profile ? `${a.profile.firstName}|${a.profile.lastName}` : 'none'}</Text>
      <Text testID="memberships">{String(a.memberships.length)}</Text>
      <Text testID="onboardingSeen">{String(a.onboardingSeen)}</Text>
      <Text testID="editInProgress">{String(a.editInProgress)}</Text>
      <Pressable testID="btn-ensure" onPress={() => { void a.ensureProfile('Ada', 'Lovelace'); }} />
      <Pressable testID="btn-update" onPress={() => { void a.updateProfileName('Ada', 'Lovelace'); }} />
      <Pressable testID="btn-signOut" onPress={() => { void a.signOut(); }} />
      <Pressable testID="btn-delete" onPress={() => { void a.deleteAccount(); }} />
      <Pressable testID="btn-switch" onPress={() => { void a.setActiveHousehold('hh2').catch(() => {}); }} />
      <Pressable testID="btn-switch-hh3" onPress={() => { void a.setActiveHousehold('hh3').catch(() => {}); }} />
      <Pressable testID="btn-onboard" onPress={() => { void a.markOnboardingSeen(); }} />
      <Pressable testID="btn-edit-on" onPress={() => a.setEditInProgress(true)} />
    </>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>,
  );
}

async function emitAuth(user: any) {
  await act(async () => {
    await authCb(user);
  });
}

async function waitForReady() {
  await waitFor(() => expect(screen.getByTestId('initializing').props.children).toBe('false'));
}

function resetHouseholdSwitchMocks() {
  mockPersistActiveHouseholdId.mockReset();
  mockPersistActiveHouseholdId.mockImplementation(async () => {});
  mockBootstrapHouseholdId.mockReset();
  mockBootstrapHouseholdId.mockImplementation(async () => {});
}

describe('AuthProvider session + household bootstrap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetHouseholdSwitchMocks();
    mockOnAuthStateChanged.mockImplementation((cb: AuthCb) => {
      authCb = cb;
      return jest.fn();
    });
    mockGetCurrentUser.mockReturnValue(null);
    mockGetProfile.mockResolvedValue(null);
    mockEnsureHouseholdForUser.mockResolvedValue('hh1');
    mockGetUserMemberships.mockResolvedValue([]);
    mockGetIsPremium.mockResolvedValue(false);
    mockAcceptPhoneInviteIfAny.mockResolvedValue({ joined: false });
    mockAcceptInvite.mockResolvedValue({ ok: true, newHouseholdId: 'hh-invite' });
    mockGetCurrentHouseholdId.mockReturnValue('hh1');
    mockSubscribeToPendingInvite.mockImplementation(() => jest.fn());
    mockHasGoogleProvider.mockReturnValue(false);
  });

  it('throws when useAuth is used outside AuthProvider', () => {
    expect(() => render(<Consumer />)).toThrow('useAuth must be used inside AuthProvider');
  });

  it('configures Google Sign-In from expo extra and settles signed-out as not initializing', async () => {
    renderProvider();
    await act(async () => {
      await authCb(null);
    });
    await waitForReady();

    expect(mockConfigureGoogleSignIn).toHaveBeenCalledWith('web-client-id');
    expect(screen.getByTestId('uid').props.children).toBe('none');
    expect(screen.getByTestId('memberships').props.children).toBe('0');
  });

  it('on sign-in bootstraps the household, attaches listeners, and runs recurring processors once per uid', async () => {
    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();

    expect(mockSetCurrentUserId).toHaveBeenCalledWith('u1');
    expect(mockEnsureHouseholdForUser).toHaveBeenCalledWith({
      uid: 'u1',
      email: 'jane@example.com',
      displayName: 'Jane Doe',
    });
    expect(mockBootstrapHouseholdId).toHaveBeenCalledWith('u1', 'hh1');
    expect(mockPersistActiveHouseholdId).toHaveBeenCalledWith('u1', 'hh1');
    expect(mockEnsureMembership).toHaveBeenCalledWith('u1', 'hh1');
    expect(mockSubscribeToHouseholdReceipts).toHaveBeenCalledWith('hh1', 'u1');
    expect(mockProcessRecurringReceipts).toHaveBeenCalledTimes(1);
    expect(mockProcessRecurringIncomes).toHaveBeenCalledTimes(1);

    // Token-refresh echo of the same uid must not re-run recurring.
    await emitAuth(makeUser());
    expect(mockProcessRecurringReceipts).toHaveBeenCalledTimes(1);
    expect(mockProcessRecurringIncomes).toHaveBeenCalledTimes(1);
  });

  it('keeps initializing true until the local profile load finishes', async () => {
    let resolveProfile: (value: null) => void = () => {};
    mockGetProfile.mockImplementation(
      () => new Promise((resolve) => {
        resolveProfile = resolve;
      }),
    );

    renderProvider();
    await act(async () => {
      await authCb(makeUser());
    });

    expect(screen.getByTestId('initializing').props.children).toBe('true');
    expect(screen.getByTestId('uid').props.children).toBe('u1');

    await act(async () => {
      resolveProfile(null);
    });
    await waitForReady();
    expect(screen.getByTestId('profile').props.children).toBe('none');
  });

  it('backfills Firebase displayName from the local profile when Auth has none', async () => {
    mockGetProfile.mockResolvedValue({
      uid: 'u1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      phoneVerified: false,
      createdAt: 't',
      updatedAt: 't',
    });
    mockGetCurrentUser.mockReturnValue(makeUser({ displayName: 'Jane Doe' }));

    renderProvider();
    await emitAuth(makeUser({ displayName: null }));
    await waitForReady();

    await waitFor(() => {
      expect(mockUpdateAuthDisplayName).toHaveBeenCalledWith('Jane Doe');
    });
  });

  it('writes emailIndex only when the email is verified (and never claims an unverified slot)', async () => {
    renderProvider();
    await emitAuth(makeUser({ emailVerified: false }));
    await waitForReady();

    await waitFor(() => expect(mockEnsureHouseholdForUser).toHaveBeenCalled());
    expect(mockSetEmailIndex).not.toHaveBeenCalled();

    await emitAuth(makeUser({ emailVerified: true }));
    await waitFor(() => {
      expect(mockSetEmailIndex).toHaveBeenCalledWith(
        'u1',
        'jane@example.com',
        expect.objectContaining({ displayName: 'Jane Doe' }),
      );
    });
  });

  it('clears household + memberships on sign-out', async () => {
    mockGetUserMemberships.mockResolvedValue([
      { householdId: 'hh1', name: 'Home', role: 'owner', memberCount: 1, isDefault: true },
    ]);
    renderProvider();
    await emitAuth(makeUser());
    await waitFor(() => expect(screen.getByTestId('memberships').props.children).toBe('1'));

    await emitAuth(null);
    await waitForReady();

    expect(mockSetCurrentHouseholdId).toHaveBeenCalledWith(null);
    expect(screen.getByTestId('uid').props.children).toBe('none');
    expect(screen.getByTestId('memberships').props.children).toBe('0');
  });

  it('setActiveHousehold no-ops while signed out, then tears down and resubscribes after sign-in', async () => {
    const firstUnsub = jest.fn();
    const secondUnsub = jest.fn();
    mockSubscribeToHouseholdReceipts
      .mockReturnValueOnce(firstUnsub)
      .mockReturnValueOnce(secondUnsub);

    renderProvider();
    await emitAuth(null);
    await waitForReady();

    fireEvent.press(screen.getByTestId('btn-switch'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockBootstrapHouseholdId).not.toHaveBeenCalled();

    await emitAuth(makeUser());
    await waitForReady();
    expect(mockBootstrapHouseholdId).toHaveBeenCalledWith('u1', 'hh1');

    fireEvent.press(screen.getByTestId('btn-switch'));
    await waitFor(() => {
      expect(mockBootstrapHouseholdId).toHaveBeenCalledWith('u1', 'hh2');
    });
    expect(firstUnsub).toHaveBeenCalled();
    expect(mockSubscribeToHouseholdReceipts).toHaveBeenLastCalledWith('hh2', 'u1');
    expect(mockNotifyLocalDataChanged).toHaveBeenCalled();
  });

  it('does not re-bootstrap the household on a Firebase token refresh for the same uid', async () => {
    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();
    const bootstrapCalls = mockBootstrapHouseholdId.mock.calls.length;
    const persistCalls = mockPersistActiveHouseholdId.mock.calls.length;

    await emitAuth(makeUser({ displayName: 'Jane Doe Updated' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockBootstrapHouseholdId.mock.calls.length).toBe(bootstrapCalls);
    expect(mockPersistActiveHouseholdId.mock.calls.length).toBe(persistCalls);
  });

  it('serializes back-to-back setActiveHousehold calls so both complete in order', async () => {
    const order: string[] = [];
    mockPersistActiveHouseholdId.mockImplementation(async (_uid: string, hid: string) => {
      order.push(`persist:${hid}`);
    });
    mockBootstrapHouseholdId.mockImplementation(async (_uid: string, hid: string) => {
      order.push(`bootstrap:${hid}`);
    });

    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();
    order.length = 0;

    await act(async () => {
      fireEvent.press(screen.getByTestId('btn-switch'));
      fireEvent.press(screen.getByTestId('btn-switch-hh3'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(order.filter((s) => s.startsWith('bootstrap:')).length).toBe(2);
    });
    const bootstrapOrder = order
      .filter((s) => s.startsWith('bootstrap:'))
      .map((s) => s.split(':')[1]);
    expect(bootstrapOrder).toEqual(['hh2', 'hh3']);
  });

  it('persists the chosen household before bootstrapping local currentHouseholdId', async () => {
    const order: string[] = [];
    let releasePersist: () => void = () => {};
    mockPersistActiveHouseholdId.mockImplementation(async (_uid: string, hid: string) => {
      if (hid !== 'hh2') return;
      order.push('persist-start');
      await new Promise<void>((resolve) => {
        releasePersist = resolve;
      });
      order.push('persist-end');
    });
    mockBootstrapHouseholdId.mockImplementation(async (_uid: string, hid: string) => {
      if (hid === 'hh2') order.push('bootstrap');
    });

    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();
    order.length = 0;

    fireEvent.press(screen.getByTestId('btn-switch'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(order).toEqual(['persist-start']);
    expect(mockBootstrapHouseholdId).not.toHaveBeenCalledWith('u1', 'hh2');

    await act(async () => {
      releasePersist();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(order).toEqual(['persist-start', 'persist-end', 'bootstrap']);
    });
  });

  it('lets a later setActiveHousehold run after an earlier switch fails', async () => {
    mockPersistActiveHouseholdId.mockImplementation(async (_uid: string, hid: string) => {
      if (hid === 'hh2') throw new Error('persist failed');
    });

    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();

    fireEvent.press(screen.getByTestId('btn-switch'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockBootstrapHouseholdId).not.toHaveBeenCalledWith('u1', 'hh2');

    fireEvent.press(screen.getByTestId('btn-switch-hh3'));
    await waitFor(() => {
      expect(mockPersistActiveHouseholdId).toHaveBeenCalledWith('u1', 'hh3');
      expect(mockBootstrapHouseholdId).toHaveBeenCalledWith('u1', 'hh3');
    });
  });
});

describe('AuthProvider profile + account actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetHouseholdSwitchMocks();
    mockOnAuthStateChanged.mockImplementation((cb: AuthCb) => {
      authCb = cb;
      return jest.fn();
    });
    mockGetCurrentUser.mockReturnValue(makeUser());
    mockGetProfile.mockResolvedValue(null);
    mockEnsureHouseholdForUser.mockResolvedValue('hh1');
    mockGetUserMemberships.mockResolvedValue([]);
    mockGetCurrentHouseholdId.mockReturnValue('hh1');
  });

  it('ensureProfile no-ops when a local profile already exists', async () => {
    mockGetProfile.mockResolvedValue({
      uid: 'u1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      phoneVerified: false,
      createdAt: 't',
      updatedAt: 't',
    });
    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();

    fireEvent.press(screen.getByTestId('btn-ensure'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSaveProfile).not.toHaveBeenCalled();
  });

  it('ensureProfile writes a new profile and best-effort updates Auth displayName', async () => {
    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();

    fireEvent.press(screen.getByTestId('btn-ensure'));
    await waitFor(() => {
      expect(mockSaveProfile).toHaveBeenCalledWith('u1', { firstName: 'Ada', lastName: 'Lovelace' }, null);
    });
    await waitFor(() => {
      expect(mockUpdateAuthDisplayName).toHaveBeenCalledWith('Ada Lovelace');
    });
    expect(screen.getByTestId('profile').props.children).toBe('Ada|Lovelace');
  });

  it('updateProfileName overwrites the existing profile row', async () => {
    const existing = {
      uid: 'u1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      phoneVerified: false,
      createdAt: 't',
      updatedAt: 't',
    };
    mockGetProfile.mockResolvedValue(existing);
    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();

    fireEvent.press(screen.getByTestId('btn-update'));
    await waitFor(() => {
      expect(mockSaveProfile).toHaveBeenCalledWith(
        'u1',
        { firstName: 'Ada', lastName: 'Lovelace' },
        existing,
      );
    });
  });

  it('deleteAccount wipes cloud while still authenticated, then local data, then the Auth account', async () => {
    const order: string[] = [];
    mockDeleteCloudUserData.mockImplementation(async () => {
      order.push('cloud');
    });
    mockDeleteAllReceipts.mockImplementation(async () => {
      order.push('receipts');
    });
    mockDeleteProfile.mockImplementation(async () => {
      order.push('profile');
    });
    mockResetAllSecureStorage.mockImplementation(async () => {
      order.push('secure');
    });
    mockDeleteCurrentAccount.mockImplementation(async () => {
      order.push('auth');
    });

    renderProvider();
    await emitAuth(makeUser({ phoneNumber: '+15551212' }));
    await waitForReady();

    fireEvent.press(screen.getByTestId('btn-delete'));
    await waitFor(() => expect(mockDeleteCurrentAccount).toHaveBeenCalled());

    expect(mockDeleteCloudUserData).toHaveBeenCalledWith({
      uid: 'u1',
      householdId: 'hh1',
      email: 'jane@example.com',
      phoneE164: '+15551212',
    });
    // Cloud wipe must happen first (token still valid). Local rows +
    // secure storage come next; Auth deletion is last because it
    // invalidates the Firebase token. deleteAllReceipts / deleteProfile
    // run in Promise.all so their relative order is not load-bearing.
    expect(order[0]).toBe('cloud');
    expect(order[order.length - 1]).toBe('auth');
    expect(order).toContain('receipts');
    expect(order).toContain('profile');
    expect(order).toContain('secure');
    expect(order.indexOf('secure')).toBeGreaterThan(order.indexOf('receipts'));
    expect(order.indexOf('secure')).toBeGreaterThan(order.indexOf('profile'));
  });


  it('signOut clears local session and tears down listeners without waiting for onAuthStateChanged', async () => {
    // iOS: Google/Firebase sign-out can resolve while onAuthStateChanged
    // lags or misses a beat. The context must drop user/profile/memberships
    // itself so Settings is not left mounted with a non-null user (which
    // skips the auth-gate redirect).
    const unsubReceipts = jest.fn();
    const unsubSettlements = jest.fn();
    const unsubIncomes = jest.fn();
    const unsubGoals = jest.fn();
    const unsubInvestments = jest.fn();
    const unsubBudgets = jest.fn();
    mockSubscribeToHouseholdReceipts.mockReturnValue(unsubReceipts);
    mockSubscribeToHouseholdSettlements.mockReturnValue(unsubSettlements);
    mockSubscribeToHouseholdIncomes.mockReturnValue(unsubIncomes);
    mockSubscribeToHouseholdSavingsGoals.mockReturnValue(unsubGoals);
    mockSubscribeToInvestments.mockReturnValue(unsubInvestments);
    mockSubscribeToHouseholdBudgets.mockReturnValue(unsubBudgets);
    mockGetUserMemberships.mockResolvedValue([
      { householdId: 'hh1', name: 'Home', role: 'owner', memberCount: 1, isDefault: true },
    ]);
    mockGetProfile.mockResolvedValue({
      uid: 'u1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      phoneVerified: false,
      createdAt: 't',
      updatedAt: 't',
    });

    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();
    await waitFor(() => expect(screen.getByTestId('memberships').props.children).toBe('1'));
    expect(screen.getByTestId('uid').props.children).toBe('u1');
    expect(screen.getByTestId('profile').props.children).toBe('Jane|Doe');

    fireEvent.press(screen.getByTestId('btn-signOut'));
    await waitFor(() => expect(mockSignOutEverywhere).toHaveBeenCalled(), { timeout: 4000 });

    // Do not emitAuth(null) — that is the lagging path this regression covers.
    expect(screen.getByTestId('uid').props.children).toBe('none');
    expect(screen.getByTestId('profile').props.children).toBe('none');
    expect(screen.getByTestId('memberships').props.children).toBe('0');
    expect(mockSetCurrentHouseholdId).toHaveBeenCalledWith(null);
    expect(unsubReceipts).toHaveBeenCalled();
    expect(unsubSettlements).toHaveBeenCalled();
    expect(unsubIncomes).toHaveBeenCalled();
    expect(unsubGoals).toHaveBeenCalled();
    expect(unsubInvestments).toHaveBeenCalled();
    expect(unsubBudgets).toHaveBeenCalled();
  });

  it('signOut delegates to signOutEverywhere and markOnboardingSeen persists + flips state', async () => {
    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();

    fireEvent.press(screen.getByTestId('btn-signOut'));
    await waitFor(() => expect(mockSignOutEverywhere).toHaveBeenCalled(), { timeout: 4000 });
    expect(mockSignOutEverywhere).toHaveBeenCalledWith({ google: false });

    fireEvent.press(screen.getByTestId('btn-onboard'));
    await waitFor(() => expect(mockSetOnboardingSeen).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('onboardingSeen').props.children).toBe('true'));
    // new users skip the current release's What's new
    expect(mockSetWhatsNewSeen).toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('btn-edit-on'));
    expect(screen.getByTestId('editInProgress').props.children).toBe('true');
  });

  it('clears session + tears down household listeners immediately, without waiting for onAuthStateChanged', async () => {
    const unsubReceipts = jest.fn();
    const unsubSettlements = jest.fn();
    const unsubIncomes = jest.fn();
    const unsubGoals = jest.fn();
    const unsubInvestments = jest.fn();
    const unsubBudgets = jest.fn();
    mockSubscribeToHouseholdReceipts.mockReturnValue(unsubReceipts);
    mockSubscribeToHouseholdSettlements.mockReturnValue(unsubSettlements);
    mockSubscribeToHouseholdIncomes.mockReturnValue(unsubIncomes);
    mockSubscribeToHouseholdSavingsGoals.mockReturnValue(unsubGoals);
    mockSubscribeToInvestments.mockReturnValue(unsubInvestments);
    mockSubscribeToHouseholdBudgets.mockReturnValue(unsubBudgets);
    mockGetUserMemberships.mockResolvedValue([
      { householdId: 'hh1', name: 'Home', role: 'owner', memberCount: 1, isDefault: true },
    ]);
    mockGetProfile.mockResolvedValue({
      uid: 'u1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      phoneVerified: false,
      createdAt: 't',
      updatedAt: 't',
    });

    renderProvider();
    await emitAuth(makeUser());
    await waitFor(() => expect(screen.getByTestId('memberships').props.children).toBe('1'));
    await waitFor(() => expect(screen.getByTestId('profile').props.children).toBe('Jane|Doe'));
    expect(mockSubscribeToHouseholdIncomes).toHaveBeenCalledWith('hh1', 'u1');

    fireEvent.press(screen.getByTestId('btn-signOut'));
    await waitFor(() => expect(mockSignOutEverywhere).toHaveBeenCalled(), { timeout: 4000 });

    // iOS can miss the null onAuthStateChanged tick — local state must
    // already look signed-out so the auth guard can leave Settings.
    expect(screen.getByTestId('uid').props.children).toBe('none');
    expect(screen.getByTestId('profile').props.children).toBe('none');
    expect(screen.getByTestId('memberships').props.children).toBe('0');
    expect(mockSetCurrentHouseholdId).toHaveBeenCalledWith(null);
    expect(unsubReceipts).toHaveBeenCalled();
    expect(unsubSettlements).toHaveBeenCalled();
    expect(unsubIncomes).toHaveBeenCalled();
    expect(unsubGoals).toHaveBeenCalled();
    expect(unsubInvestments).toHaveBeenCalled();
    expect(unsubBudgets).toHaveBeenCalled();
  });

  it('clears local session after the iOS alert settle, then defers native sign-out', async () => {
    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();
    expect(screen.getByTestId('uid').props.children).toBe('u1');

    fireEvent.press(screen.getByTestId('btn-signOut'));

    // Same turn as the confirm alert: do not mutate session or native auth.
    expect(screen.getByTestId('uid').props.children).toBe('u1');
    expect(mockSignOutEverywhere).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByTestId('uid').props.children).toBe('none'), {
      timeout: IOS_ALERT_SETTLE_MS + 1500,
    });
    expect(screen.getByTestId('profile').props.children).toBe('none');
    expect(screen.getByTestId('memberships').props.children).toBe('0');
    expect(mockSetCurrentHouseholdId).toHaveBeenCalledWith(null);

    if (NATIVE_SIGNOUT_DEFER_MS > 0) {
      expect(mockSignOutEverywhere).not.toHaveBeenCalled();
    }

    await waitFor(() => expect(mockSignOutEverywhere).toHaveBeenCalledWith({ google: false }), {
      timeout: NATIVE_SIGNOUT_DEFER_MS + 2000,
    });
  });

  it('tells signOutEverywhere to fire Google native sign-out only for google.com sessions', async () => {
    mockHasGoogleProvider.mockReturnValue(true);
    renderProvider();
    await emitAuth(makeUser({ providerData: [{ providerId: 'google.com' }] }));
    await waitForReady();

    fireEvent.press(screen.getByTestId('btn-signOut'));
    await waitFor(() => expect(mockSignOutEverywhere).toHaveBeenCalledWith({ google: true }), {
      timeout: IOS_ALERT_SETTLE_MS + NATIVE_SIGNOUT_DEFER_MS + 2000,
    });
  });
});

describe('AuthProvider invite + phone-invite permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetHouseholdSwitchMocks();
    mockOnAuthStateChanged.mockImplementation((cb: AuthCb) => {
      authCb = cb;
      return jest.fn();
    });
    mockGetCurrentUser.mockReturnValue(makeUser());
    mockGetProfile.mockResolvedValue(null);
    mockEnsureHouseholdForUser.mockResolvedValue('hh1');
    mockGetUserMemberships.mockResolvedValue([]);
    mockGetIsPremium.mockResolvedValue(false);
    mockAcceptInvite.mockResolvedValue({ ok: true, newHouseholdId: 'hh-invite' });
    mockAcceptPhoneInviteIfAny.mockResolvedValue({ joined: false });
    mockSubscribeToPendingInvite.mockImplementation(() => jest.fn());
    mockHasGoogleProvider.mockReturnValue(false);
  });

  it('auto-joins a verified-phone invite and switches to that household', async () => {
    mockGetProfile.mockResolvedValue({
      uid: 'u1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+15550001111',
      phoneVerified: true,
      createdAt: 't',
      updatedAt: 't',
    });
    mockAcceptPhoneInviteIfAny.mockResolvedValue({ joined: true, householdId: 'hh-phone' });

    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();

    await waitFor(() => {
      expect(mockAcceptPhoneInviteIfAny).toHaveBeenCalledWith('u1', '+15550001111');
    });
    await waitFor(() => {
      expect(mockBootstrapHouseholdId).toHaveBeenCalledWith('u1', 'hh-phone');
    });
    expect(mockSetPhoneIndex).toHaveBeenCalledWith(
      'u1',
      '+15550001111',
      expect.objectContaining({ displayName: 'Jane Doe' }),
    );
  });

  it('does not auto-join a phone invite when the number is present but unverified', async () => {
    mockGetProfile.mockResolvedValue({
      uid: 'u1',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+15550001111',
      phoneVerified: false,
      createdAt: 't',
      updatedAt: 't',
    });
    mockAcceptPhoneInviteIfAny.mockResolvedValue({ joined: true, householdId: 'hh-phone' });

    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();

    await waitFor(() => expect(mockEnsureHouseholdForUser).toHaveBeenCalled());
    expect(mockAcceptPhoneInviteIfAny).not.toHaveBeenCalled();
    expect(mockSetPhoneIndex).not.toHaveBeenCalled();
  });

  it('accepts an email invite into a first household without a Premium check', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let inviteCb: ((invite: any) => void) | null = null;
    mockSubscribeToPendingInvite.mockImplementation((_email: string, cb: (invite: any) => void) => {
      inviteCb = cb;
      return jest.fn();
    });
    mockGetUserMemberships.mockResolvedValue([]);

    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();
    await waitFor(() => expect(inviteCb).toBeTruthy());

    act(() => {
      inviteCb!({
        householdId: 'hh-invite',
        invitedByUid: 'u2',
        invitedByName: 'Pat',
        invitedByEmail: 'pat@example.com',
        householdName: 'Cabin',
        createdAt: 1,
      });
    });

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      await buttons.find((b) => b.text === 'Accept')?.onPress?.();
    });

    expect(mockGetIsPremium).not.toHaveBeenCalled();
    expect(mockAcceptInvite).toHaveBeenCalledWith({
      invite: expect.objectContaining({ householdId: 'hh-invite' }),
      uid: 'u1',
    });
    await waitFor(() => {
      expect(mockBootstrapHouseholdId).toHaveBeenCalledWith('u1', 'hh-invite');
    });
    alertSpy.mockRestore();
  });

  /**
   * Belonging to more than one household is Premium. The accept path
   * must re-check entitlements itself (not trust the Households screen)
   * because this Alert is presented from AuthProvider on a live
   * Firestore invite — a free user already in a household who taps
   * Accept would otherwise silently join a second household.
   */
  it('blocks Accept on a second-household invite for a free user and routes to paywall', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let inviteCb: ((invite: any) => void) | null = null;
    mockSubscribeToPendingInvite.mockImplementation((_email: string, cb: (invite: any) => void) => {
      inviteCb = cb;
      return jest.fn();
    });
    mockGetUserMemberships.mockResolvedValue([
      { householdId: 'hh1', name: 'Home', role: 'owner', memberCount: 1, isDefault: true },
    ]);
    mockGetIsPremium.mockResolvedValue(false);

    renderProvider();
    await emitAuth(makeUser());
    await waitFor(() => expect(screen.getByTestId('memberships').props.children).toBe('1'));
    await waitFor(() => expect(inviteCb).toBeTruthy());

    act(() => {
      inviteCb!({
        householdId: 'hh-invite',
        invitedByUid: 'u2',
        invitedByName: 'Pat',
        invitedByEmail: 'pat@example.com',
        householdName: 'Cabin',
        createdAt: 2,
      });
    });

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const firstButtons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      await firstButtons.find((b) => b.text === 'Accept')?.onPress?.();
    });

    expect(mockAcceptInvite).not.toHaveBeenCalled();
    expect(mockGetIsPremium).toHaveBeenCalled();
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Upgrade to join another household',
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Not now' }),
          expect.objectContaining({ text: 'Upgrade' }),
        ]),
      );
    });

    const upgradeButtons = alertSpy.mock.calls[1][2] as { text: string; onPress?: () => void }[];
    upgradeButtons.find((b) => b.text === 'Upgrade')?.onPress?.();
    expect(mockRouterPush).toHaveBeenCalledWith('/paywall');
    alertSpy.mockRestore();
  });

  it('does not pop the same pending invite Alert twice (cache-then-server snapshot)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let inviteCb: ((invite: any) => void) | null = null;
    mockSubscribeToPendingInvite.mockImplementation((_email: string, cb: (invite: any) => void) => {
      inviteCb = cb;
      return jest.fn();
    });

    renderProvider();
    await emitAuth(makeUser());
    await waitForReady();
    await waitFor(() => expect(inviteCb).toBeTruthy());

    const invite = {
      householdId: 'hh-invite',
      invitedByUid: 'u2',
      invitedByName: 'Pat',
      invitedByEmail: 'pat@example.com',
      householdName: 'Cabin',
      createdAt: 9,
    };
    act(() => {
      inviteCb!(invite);
      inviteCb!(invite);
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });
});
