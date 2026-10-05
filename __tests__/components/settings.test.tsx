import React from 'react';
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react-native';
import { Alert } from 'react-native';

// NOTE: mocks that return plain object literals (expo-router, expo-file-
// system, lib/database, lib/secureStorage, lib/notifications, lib/cloudSync)
// build their jest.fn()s inline rather than closing over outer consts —
// those factories run EAGERLY at first
// require (which, via ES import hoisting, can happen before an outer
// `const mock... = jest.fn()` in this file is actually assigned). We
// recover references to the created fns afterwards via the (now-mocked)
// module's exports. useAuth/useToast are safe to close over outer consts
// since they're wrapped in a function only invoked later at render time.
const mockSignOut = jest.fn(async () => {});
const mockRefreshProfile = jest.fn(async () => {});
const mockSetActiveHousehold = jest.fn(async () => {});
const mockToastShow = jest.fn();

const mockSettingsPush = jest.fn();
let mockSearchParams: Record<string, string> = {};
let mockIsPremium = false;
let mockLanguagePreference = 'system';
const mockSetLanguage = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockSettingsPush, replace: jest.fn() }),
  useLocalSearchParams: () => mockSearchParams,
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: jest.fn(async () => {}),
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'jane@example.com', displayName: 'Jane Doe' },
    profile: { firstName: 'Jane', lastName: 'Doe', phone: null },
    signOut: mockSignOut,
    refreshProfile: mockRefreshProfile,
    setActiveHousehold: mockSetActiveHousehold,
  }),
}));

jest.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: mockToastShow, dismiss: jest.fn() }),
}));

jest.mock('../../lib/EntitlementsContext', () => ({
  useEntitlements: () => ({
    loading: false,
    isPremium: mockIsPremium,
    offerings: null,
    refreshOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
  }),
}));

jest.mock('../../lib/I18nContext', () => {
  const { translate } = require('../../lib/i18n');
  return {
    useT: () => (key: string, params?: Record<string, string | number>) =>
      translate('en', key, params),
    useLanguage: () => ({
      language: 'en',
      preference: mockLanguagePreference,
      setPreference: mockSetLanguage,
    }),
  };
});

jest.mock('../../lib/entitlements', () => ({
  getManagementUrl: jest.fn(async () => null),
}));

jest.mock('../../lib/database', () => ({
  getAllReceipts: jest.fn(async () => []),
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
}));

jest.mock('../../lib/secureStorage', () => ({
  getBudgetAlertsEnabled: jest.fn(async () => true),
  getBudgetsSnapshot: jest.fn(async () => ({ byCategory: {}, alertsEnabled: true })),
  getCategoryBudgets: jest.fn(async () => ({})),
  getCurrency: jest.fn(async () => 'USD'),
  setBudgetAlertsEnabled: jest.fn(async () => {}),
  setCategoryBudget: jest.fn(async () => {}),
  setCurrency: jest.fn(async () => {}),
}));

jest.mock('../../lib/customCategories', () => ({
  MAX_CUSTOM_CATEGORY_NAME: 24,
  getCustomCategories: jest.fn(async () => [{ name: 'Pets', color: '#D6336C' }]),
  addCustomCategory: jest.fn(),
  removeCustomCategory: jest.fn(async () => []),
  getCustomCategoriesSynced: jest.fn(async () => false),
  setCustomCategoriesSynced: jest.fn(async () => {}),
}));

jest.mock('../../lib/notifications', () => ({
  registerForPushNotificationsAsync: jest.fn(async () => null),
  requestNotificationPermission: jest.fn(async () => true),
}));

jest.mock('../../lib/cloudSync', () => ({
  getHouseholdMembers: jest.fn(async () => []),
  inviteUserToHousehold: jest.fn(async () => ({ ok: true })),
  isCloudSyncAvailable: jest.fn(() => true),
  leaveHousehold: jest.fn(async () => ({ ok: true, nextActiveHouseholdId: 'hh-solo' })),
  syncBudgetsToCloud: jest.fn(async () => {}),
  syncCustomCategoriesToCloud: jest.fn(async () => true),
  syncPushTokenToCloud: jest.fn(async () => {}),
}));

jest.mock('../../lib/reports', () => ({
  receiptsToCsv: jest.fn(() => 'store,amount\n'),
}));

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

import SettingsScreen from '../../app/settings';
import { getHouseholdMembers, inviteUserToHousehold, leaveHousehold } from '../../lib/cloudSync';
import { getAllReceipts } from '../../lib/database';
import {
  getCategoryBudgets,
  setBudgetAlertsEnabled,
  setCategoryBudget,
  setCurrency,
} from '../../lib/secureStorage';
import {
  removeCustomCategory,
  setCustomCategoriesSynced,
} from '../../lib/customCategories';
import { syncCustomCategoriesToCloud } from '../../lib/cloudSync';
import { requestNotificationPermission } from '../../lib/notifications';

const mockGetHouseholdMembers = getHouseholdMembers as jest.Mock;
const mockInviteUserToHousehold = inviteUserToHousehold as jest.Mock;
const mockLeaveHousehold = leaveHousehold as jest.Mock;
const mockGetAllReceipts = getAllReceipts as jest.Mock;
const mockSetBudgetAlertsEnabled = setBudgetAlertsEnabled as jest.Mock;
const mockRequestNotificationPermission = requestNotificationPermission as jest.Mock;

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPremium = false;
    mockLanguagePreference = 'system';
    mockGetHouseholdMembers.mockResolvedValue([]);
    mockInviteUserToHousehold.mockResolvedValue({ ok: true });
    mockLeaveHousehold.mockResolvedValue({ ok: true, nextActiveHouseholdId: 'hh-solo' });
    mockGetAllReceipts.mockResolvedValue([]);
    mockSetBudgetAlertsEnabled.mockResolvedValue(undefined);
    mockRequestNotificationPermission.mockResolvedValue(true);
  });

  it('renders without crashing for a signed-in user with a profile', async () => {
    render(<SettingsScreen />);
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeTruthy();
    });
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.getByText('jane@example.com')).toBeTruthy();
    expect(screen.getByText('Sign out')).toBeTruthy();
    expect(screen.getByText('All incomes')).toBeTruthy();
    expect(screen.getByText('Savings goals · Premium')).toBeTruthy();
  });

  it('opens All incomes and paywalls savings goals for a free user', async () => {
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText('All incomes'));
    fireEvent.press(screen.getByText('All incomes'));
    expect(mockSettingsPush).toHaveBeenCalledWith('/incomes');
    fireEvent.press(screen.getByText('Savings goals · Premium'));
    expect(mockSettingsPush).toHaveBeenCalledWith('/paywall');
  });

  it('Investments row is Premium: paywall for free users, portfolio for Premium', async () => {
    render(<SettingsScreen />);
    await waitFor(() => screen.getByTestId('settings-investments'));
    expect(screen.getByText('Investments · Pro')).toBeTruthy();
    fireEvent.press(screen.getByTestId('settings-investments'));
    expect(mockSettingsPush).toHaveBeenCalledWith('/paywall');
  });

  it('Premium user opens the investments portfolio from Settings', async () => {
    mockIsPremium = true;
    render(<SettingsScreen />);
    await waitFor(() => screen.getByTestId('settings-investments'));
    fireEvent.press(screen.getByTestId('settings-investments'));
    expect(mockSettingsPush).toHaveBeenCalledWith('/investments');
  });

  it('language picker offers System / English / Français and saves the choice', async () => {
    render(<SettingsScreen />);
    await waitFor(() => screen.getByTestId('language-fr'));
    expect(screen.getByText('English')).toBeTruthy();
    expect(screen.getByText('Français')).toBeTruthy();
    fireEvent.press(screen.getByTestId('language-fr'));
    expect(mockSetLanguage).toHaveBeenCalledWith('fr');
    fireEvent.press(screen.getByTestId('language-en'));
    expect(mockSetLanguage).toHaveBeenCalledWith('en');
    fireEvent.press(screen.getByTestId('language-system'));
    expect(mockSetLanguage).toHaveBeenCalledWith('system');
  });

  it('free user: premium currency pill opens the paywall instead of switching', async () => {
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText('AUD 🔒'));
    fireEvent.press(screen.getByText('AUD 🔒'));
    expect(mockSettingsPush).toHaveBeenCalledWith('/paywall');
    expect(setCurrency).not.toHaveBeenCalled();
    // free currencies still switch normally
    fireEvent.press(screen.getByText('EUR'));
    expect(setCurrency).toHaveBeenCalledWith('EUR');
  });

  it('premium user: premium currency pill switches currency', async () => {
    mockIsPremium = true;
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText('JPY'));
    expect(screen.queryByText('JPY 🔒')).toBeNull();
    fireEvent.press(screen.getByText('JPY'));
    expect(setCurrency).toHaveBeenCalledWith('JPY');
    expect(mockSettingsPush).not.toHaveBeenCalledWith('/paywall');
  });

  it('free user: sees the household\'s shared custom categories and can set their budget, but not remove or add', async () => {
    render(<SettingsScreen />);
    await waitFor(() => screen.getByTestId('custom-budget-row-Pets'));
    // no remove control and the create affordance is the locked upsell
    expect(screen.queryByTestId('custom-remove-Pets')).toBeNull();
    expect(screen.queryByTestId('custom-category-add')).toBeNull();
    fireEvent.press(screen.getByTestId('custom-categories-locked'));
    expect(mockSettingsPush).toHaveBeenCalledWith('/paywall');
  });

  it('free user: can set the budget for a shared custom category', async () => {
    render(<SettingsScreen />);
    await waitFor(() => screen.getByTestId('custom-budget-row-Pets'));
    const row = screen.getByTestId('custom-budget-row-Pets');
    const input = row.findByType(require('react-native').TextInput);
    fireEvent.changeText(input, '75');
    await waitFor(() => expect(setCategoryBudget).toHaveBeenCalledWith('hh1', 'Pets', 75));
  });

  it('premium user: shows custom category budget rows and can remove one', async () => {
    mockIsPremium = true;
    render(<SettingsScreen />);
    await waitFor(() => screen.getByTestId('custom-budget-row-Pets'));
    expect(screen.queryByTestId('custom-categories-locked')).toBeNull();
    fireEvent.press(screen.getByTestId('custom-remove-Pets'));
    await waitFor(() => expect(removeCustomCategory).toHaveBeenCalledWith('hh1', 'Pets'));
    await waitFor(() => expect(screen.queryByTestId('custom-budget-row-Pets')).toBeNull());
  });

  it('syncs custom categories to the household: one-time push on load, removal on delete', async () => {
    mockIsPremium = true;
    render(<SettingsScreen />);
    await waitFor(() =>
      expect(syncCustomCategoriesToCloud).toHaveBeenCalledWith('hh1', {
        add: [{ name: 'Pets', color: '#D6336C' }],
      }),
    );
    await waitFor(() => expect(setCustomCategoriesSynced).toHaveBeenCalledWith('hh1'));
    fireEvent.press(screen.getByTestId('custom-remove-Pets'));
    await waitFor(() =>
      expect(syncCustomCategoriesToCloud).toHaveBeenCalledWith('hh1', {
        remove: [{ name: 'Pets', color: '#D6336C' }],
      }),
    );
  });

  it('does not mark categories as synced when the cloud push fails', async () => {
    mockIsPremium = true;
    (syncCustomCategoriesToCloud as jest.Mock).mockResolvedValueOnce(false);
    render(<SettingsScreen />);
    await waitFor(() => expect(syncCustomCategoriesToCloud).toHaveBeenCalled());
    await waitFor(() => screen.getByTestId('custom-budget-row-Pets'));
    expect(setCustomCategoriesSynced).not.toHaveBeenCalled();
  });

  it('premium user: removing a custom category also zeroes its budget', async () => {
    mockIsPremium = true;
    (getCategoryBudgets as jest.Mock).mockResolvedValueOnce({ Pets: 25 });
    render(<SettingsScreen />);
    await waitFor(() => screen.getByTestId('custom-budget-row-Pets'));
    fireEvent.press(screen.getByTestId('custom-remove-Pets'));
    await waitFor(() => expect(setCategoryBudget).toHaveBeenCalledWith('hh1', 'Pets', 0));
  });

  it('sending an email invite calls inviteUserToHousehold and shows a success toast', async () => {
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText('Settings'));

    fireEvent.changeText(screen.getByPlaceholderText('Invite by email'), 'friend@example.com');
    fireEvent.press(screen.getByText('Send'));

    await waitFor(() => {
      expect(mockInviteUserToHousehold).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'friend@example.com', invitedByUid: 'u1' }),
      );
    });
    await waitFor(() => {
      expect(mockToastShow).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', message: 'Invite sent' }),
      );
    });
  });

  it('toggling the notifications switch off persists the change without prompting for permission', async () => {
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText('Notifications'));

    const toggle = screen.getByRole('switch');
    fireEvent(toggle, 'valueChange', false);

    await waitFor(() => {
      expect(mockSetBudgetAlertsEnabled).toHaveBeenCalledWith('hh1', false);
    });
    expect(mockRequestNotificationPermission).not.toHaveBeenCalled();
  });

  it('tapping "Sign out" shows a confirm alert, and confirming calls signOut', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText('Sign out'));

    fireEvent.press(screen.getByText('Sign out'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Sign out?',
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel' }),
        expect.objectContaining({ text: 'Sign out' }),
      ]),
    );

    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((b) => b.text === 'Sign out')?.onPress?.();
    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalled();
    });
  });

  it('shows a leave-household confirm alert with more than one member, and confirming leaves', async () => {
    mockGetHouseholdMembers.mockResolvedValue([
      { uid: 'u1', email: 'jane@example.com', displayName: 'Jane Doe', role: 'owner', isYou: true },
      { uid: 'u2', email: 'bob@example.com', displayName: 'Bob', role: 'member', isYou: false },
    ]);
    const alertSpy = jest.spyOn(Alert, 'alert');
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText('Leave household')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Leave household'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Leave household?',
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ text: 'Leave' })]),
    );
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === 'Leave')?.onPress?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockLeaveHousehold).toHaveBeenCalledWith(
        expect.objectContaining({ uid: 'u1', householdId: 'hh1' }),
      );
    });
  });

  describe('deep link to one budget row (?section=budgets&category=…)', () => {
    afterEach(() => {
      mockSearchParams = {};
      jest.useRealTimers();
    });

    it('scrolls to that category row and focuses its amount box once the row is laid out', async () => {
      mockSearchParams = { section: 'budgets', category: 'Pets' };
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ScrollView, TextInput } = require('react-native');
      const scrollSpy = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => {});
      const focusSpy = jest.spyOn(TextInput.prototype, 'focus').mockImplementation(() => {});

      render(<SettingsScreen />);
      const row = await waitFor(() => screen.getByTestId('custom-budget-row-Pets'));
      // Row measured 300px down inside the card.
      fireEvent(row, 'layout', { nativeEvent: { layout: { x: 0, y: 300, width: 300, height: 50 } } });

      await waitFor(() => expect(scrollSpy).toHaveBeenCalled(), { timeout: 2000 });
      const last = scrollSpy.mock.calls[scrollSpy.mock.calls.length - 1][0] as { y: number };
      expect(last.y).toBeGreaterThanOrEqual(180); // 300 (row) - 120 (headroom)
      await waitFor(() => expect(focusSpy).toHaveBeenCalled(), { timeout: 2000 });

      scrollSpy.mockRestore();
      focusSpy.mockRestore();
    });
  });
});
