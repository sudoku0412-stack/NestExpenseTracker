import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import type { Receipt } from '../../types';

// This screen (app/edit/[id].tsx, ~1700 lines) is a full receipt-edit
// form with splits, line items, and recurring scheduling. Full
// interaction coverage of every one of those is out of scope here —
// this is a smoke test plus one simple, well-isolated interaction (the
// store-name text field) that doesn't require deep native mocking.
//
// NOTE: mocks below that return plain object literals (expo-router,
// expo-file-system, lib/database, lib/cloudSync, lib/secureStorage) build
// their jest.fn()s inline rather than closing over outer consts — those
// factories run eagerly at first require, which (via ES import hoisting)
// can happen before an outer `const mock... = jest.fn()` in this file is
// actually assigned. References are recovered afterwards via the
// (now-mocked) module's exports. useAuth is safe to close over an outer
// const since it's wrapped in a function only invoked later at render
// time.
const mockSetEditInProgress = jest.fn();
const mockEditPush = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'r1' }),
  useRouter: () => ({ back: jest.fn(), push: mockEditPush, replace: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
  Stack: { Screen: () => null },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: jest.fn(async () => {}),
  copyAsync: jest.fn(async () => {}),
  getInfoAsync: jest.fn(async () => ({ exists: true })),
}));

jest.mock('../../lib/database', () => ({
  getReceiptById: jest.fn(),
  updateReceipt: jest.fn(async () => {}),
  deleteReceipt: jest.fn(async () => {}),
  getAllReceipts: jest.fn(async () => []),
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
  getReceiptsByMonth: jest.fn(async () => []),
}));

jest.mock('../../lib/cloudSync', () => ({
  getHouseholdMembers: jest.fn(async () => []),
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({
    user: { uid: 'u1' },
    profile: { firstName: 'Jane', lastName: 'Doe' },
    setEditInProgress: mockSetEditInProgress,
  }),
}));

jest.mock('../../lib/EntitlementsContext', () => ({
  useEntitlements: () => ({ isPremium: false, loading: false }),
}));

jest.mock('../../lib/haptics', () => ({
  notifySuccess: jest.fn(),
  tapLight: jest.fn(),
  tapMedium: jest.fn(),
}));

jest.mock('../../lib/notifications', () => ({
  notifyHouseholdOfBudgetStatus: jest.fn(),
  notifyNewSharedExpense: jest.fn(),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCurrency: jest.fn(async () => 'USD'),
}));

jest.mock('../../lib/customCategories', () => ({
  ...jest.requireActual('../../lib/customCategories'),
  getCustomCategories: jest.fn(async () => [{ name: 'Subscriptions', color: '#D6336C' }]),
}));

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

import EditReceiptScreen from '../../app/edit/[id]';
import { getReceiptById, updateReceipt } from '../../lib/database';

const mockGetReceiptById = getReceiptById as jest.Mock;
const mockUpdateReceipt = updateReceipt as jest.Mock;

function makeReceipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: 'r1',
    storeName: 'Coffee Shop',
    date: '2026-01-15',
    totalAmount: 12.5,
    category: 'Dining',
    ...overrides,
  } as Receipt;
}

describe('EditReceiptScreen (smoke test)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the receipt's store name and total amount without throwing", async () => {
    mockGetReceiptById.mockResolvedValue(makeReceipt({ storeName: 'Coffee Shop', totalAmount: 12.5 }));
    render(<EditReceiptScreen />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Coffee Shop')).toBeTruthy();
    });
    expect(screen.getByDisplayValue('12.50')).toBeTruthy();
  });

  it('editing the store-name text field updates its value', async () => {
    mockGetReceiptById.mockResolvedValue(makeReceipt({ storeName: 'Coffee Shop' }));
    render(<EditReceiptScreen />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Coffee Shop')).toBeTruthy();
    });
    fireEvent.changeText(screen.getByDisplayValue('Coffee Shop'), 'Updated Store');
    expect(screen.getByDisplayValue('Updated Store')).toBeTruthy();
  });

  it('free user: premium currency pill opens the paywall and does not switch currency', async () => {
    mockGetReceiptById.mockResolvedValue(makeReceipt({}));
    render(<EditReceiptScreen />);
    await waitFor(() => screen.getByText('AUD 🔒'));
    fireEvent.press(screen.getByText('AUD 🔒'));
    expect(mockEditPush).toHaveBeenCalledWith('/paywall');
    expect(screen.queryByText('AUD')).toBeNull();
  });

  it('reopens a frozen-rate foreign receipt showing exactly what was typed', async () => {
    // Saved as EUR 100 at a frozen live rate of 0.95 EUR per canonical USD.
    mockGetReceiptById.mockResolvedValue(
      makeReceipt({ totalAmount: 100 / 0.95, originalCurrency: 'EUR', fxRate: 0.95 }),
    );
    render(<EditReceiptScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('100.00')).toBeTruthy());
  });

  it('without a frozen rate, the fixed table is used', async () => {
    mockGetReceiptById.mockResolvedValue(
      makeReceipt({ totalAmount: 100, originalCurrency: 'EUR' }),
    );
    render(<EditReceiptScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('92.00')).toBeTruthy());
  });

  it('offers household custom categories and saves one as the primary category', async () => {
    mockGetReceiptById.mockResolvedValue(
      makeReceipt({ category: 'Dining', categoryTags: ['Dining'] }),
    );
    render(<EditReceiptScreen />);
    await waitFor(() => expect(screen.getByText('Your categories')).toBeTruthy());
    fireEvent.press(screen.getByText('Subscriptions'));
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(mockUpdateReceipt).toHaveBeenCalled());
    const saved = mockUpdateReceipt.mock.calls[0][0];
    expect(saved.category).toBe('Subscriptions');
    expect(saved.categoryTags[0]).toBe('Subscriptions');
  });

  it('does not promote a free-text tag that is not a household custom category', async () => {
    mockGetReceiptById.mockResolvedValue(
      makeReceipt({ category: 'Dining', categoryTags: ['Pet Food'] }),
    );
    render(<EditReceiptScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('Coffee Shop')).toBeTruthy());
    fireEvent.press(screen.getByText('Save Changes'));
    await waitFor(() => expect(mockUpdateReceipt).toHaveBeenCalled());
    expect(mockUpdateReceipt.mock.calls[0][0].category).toBe('Dining');
  });
});
