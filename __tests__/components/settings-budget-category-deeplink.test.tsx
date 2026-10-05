import React from 'react';
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react-native';

// Budgets page Manage opens /settings?section=budgets&category=Groceries.
// Settings must scroll to that row (section Y + card Y + row Y − 120) and
// focus its input — not just the section header used when category is
// omitted. Layout is simulated because the RN test renderer has no engine.

const mockParams: { current: { section?: string; category?: string } } = {
  current: { section: 'budgets', category: 'Groceries' },
};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockParams.current,
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
    signOut: jest.fn(),
    refreshProfile: jest.fn(async () => {}),
    setActiveHousehold: jest.fn(async () => {}),
  }),
}));

jest.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ show: jest.fn(), dismiss: jest.fn() }),
}));

jest.mock('../../lib/EntitlementsContext', () => ({
  useEntitlements: () => ({
    loading: false,
    isPremium: false,
    offerings: null,
    refreshOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
  }),
}));

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

const mockScrollTo = jest.fn();
const mockFocusedInput = jest.fn();
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  const ReactActual = jest.requireActual('react');
  const MockScrollView = ReactActual.forwardRef((props: any, ref: any) => {
    ReactActual.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }));
    return ReactActual.createElement(RN.View, props, props.children);
  });
  const OrigTextInput = RN.TextInput;
  const MockTextInput = ReactActual.forwardRef((props: any, ref: any) => {
    ReactActual.useImperativeHandle(ref, () => ({
      focus: () => mockFocusedInput(props.testID),
    }));
    return ReactActual.createElement(OrigTextInput, props);
  });
  Object.defineProperty(RN, 'ScrollView', { value: MockScrollView, configurable: true });
  Object.defineProperty(RN, 'TextInput', { value: MockTextInput, configurable: true });
  return RN;
});

import SettingsScreen from '../../app/settings';

function fireBudgetLayouts(rowTestId: string) {
  const sectionTitle = screen.getByText('Categories & budgets');
  fireEvent(sectionTitle.parent!, 'layout', {
    nativeEvent: { layout: { y: 1000, x: 0, width: 300, height: 40 } },
  });
  const row = screen.getByTestId(rowTestId);
  fireEvent(screen.getByTestId('settings-section-card'), 'layout', {
    nativeEvent: { layout: { y: 40, x: 0, width: 300, height: 400 } },
  });
  fireEvent(row, 'layout', {
    nativeEvent: { layout: { y: 80, x: 0, width: 300, height: 44 } },
  });
}

describe('SettingsScreen budget-category deep-link', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockParams.current = { section: 'budgets', category: 'Groceries' };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('scrolls to the named row (not the section top) and focuses its input', async () => {
    render(<SettingsScreen />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('budget-row-Groceries')).toBeTruthy());

    fireBudgetLayouts('budget-row-Groceries');

    await act(async () => {
      jest.advanceTimersByTime(150);
    });
    // 1000 (section) + 40 (card) + 80 (row) − 120 = 1000
    expect(mockScrollTo).toHaveBeenCalledWith({ y: 1000, animated: true });

    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(mockFocusedInput).toHaveBeenCalledWith('budget-input-Groceries');
    expect(mockFocusedInput).not.toHaveBeenCalledWith('budget-input-Dining');
  });

  it('falls back to the section Y when the category has no measured row', async () => {
    mockParams.current = { section: 'budgets', category: 'NotACategory' };
    render(<SettingsScreen />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('budget-row-Groceries')).toBeTruthy());

    const sectionTitle = screen.getByText('Categories & budgets');
    fireEvent(sectionTitle.parent!, 'layout', {
      nativeEvent: { layout: { y: 1000, x: 0, width: 300, height: 40 } },
    });

    await act(async () => {
      jest.advanceTimersByTime(150);
    });
    expect(mockScrollTo).toHaveBeenCalledWith({ y: 1000, animated: true });

    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(mockFocusedInput).not.toHaveBeenCalled();
  });
});
