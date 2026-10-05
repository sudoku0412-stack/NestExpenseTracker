import React from 'react';
import { fireEvent, render, waitFor, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { Receipt } from '../../types';

// react-native-svg's mocked/native renderer doesn't matter here — these
// tests only assert that a ring (SVG) with the expected testID is present
// or absent, not anything about how it draws.

/** Climbs the rendered-instance parent chain from `node` until it finds
 *  one whose flattened style carries an `elevation` key (the card-style
 *  wrapper), rather than assuming a fixed number of parent hops — which
 *  would silently point at the wrong node the next time this section's
 *  JSX nesting changes. */
function nearestCardAncestorStyle(node: { parent: any; props?: Record<string, unknown> }) {
  let current: any = node;
  while (current) {
    const flattened = StyleSheet.flatten(current.props?.style);
    if (flattened && Object.prototype.hasOwnProperty.call(flattened, 'elevation')) {
      return flattened;
    }
    current = current.parent;
  }
  throw new Error('No ancestor with an `elevation` style key was found.');
}

// NOTE: mocks below that return plain object literals (expo-router,
// lib/database, lib/secureStorage, lib/notifications) build their
// jest.fn()s inline rather than closing over outer consts — those
// factories run eagerly at first require, which (via ES import hoisting)
// can happen before an outer `const mock... = jest.fn()` in this file is
// actually assigned. References are recovered afterwards via the
// (now-mocked) module's exports.

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.mock('../../lib/AuthContext', () => ({
  useAuth: () => ({
    memberships: [
      {
        householdId: 'hh1',
        name: 'Our Home',
        role: 'owner',
        memberCount: 2,
        isDefault: true,
      },
    ],
    user: { uid: 'uid-self', displayName: 'Alex' },
    profile: null,
  }),
}));

jest.mock('../../lib/cloudSync', () => ({
  getHouseholdMembers: jest.fn(async () => []),
}));

const mockEntitlements = { isPremium: true, loading: false };
jest.mock('../../lib/EntitlementsContext', () => ({
  useEntitlements: () => mockEntitlements,
}));

jest.mock('../../lib/database', () => ({
  getCurrentHouseholdId: jest.fn(() => 'hh1'),
  getReceiptsByMonth: jest.fn(),
  getIncomesByMonth: jest.fn(async () => []),
  getAllSavingsGoals: jest.fn(async () => []),
  getReviewQueueCount: jest.fn(async () => 0),
}));

jest.mock('../../lib/secureStorage', () => ({
  getCategoryBudgets: jest.fn(async () => ({})),
  getCurrency: jest.fn(async () => 'USD'),
}));

jest.mock('../../lib/notifications', () => ({
  checkBudgetsAndNotify: jest.fn(async () => {}),
}));

// lib/recurring.ts (used unmocked, real, for RECURRING_BUDGET_KEY /
// isRecurringExpense) imports uuid, which ships ESM-only and can't be
// parsed by jest's default transform.
jest.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

import { router } from 'expo-router';
import DashboardScreen from '../../app/(tabs)/index';
import {
  getReceiptsByMonth,
  getIncomesByMonth,
  getAllSavingsGoals,
  getReviewQueueCount,
} from '../../lib/database';
import { getCategoryBudgets, getCurrency } from '../../lib/secureStorage';
import { getHouseholdMembers } from '../../lib/cloudSync';

const mockGetReceiptsByMonth = getReceiptsByMonth as jest.Mock;
const mockGetIncomesByMonth = getIncomesByMonth as jest.Mock;
const mockGetAllSavingsGoals = getAllSavingsGoals as jest.Mock;
const mockGetReviewQueueCount = getReviewQueueCount as jest.Mock;
const mockGetCategoryBudgets = getCategoryBudgets as jest.Mock;
const mockGetCurrency = getCurrency as jest.Mock;
const mockGetHouseholdMembers = getHouseholdMembers as jest.Mock;

function makeReceipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: 'r1',
    storeName: 'Coffee Shop',
    date: new Date().toISOString().slice(0, 10),
    totalAmount: 10,
    category: 'Dining',
    ...overrides,
  } as Receipt;
}

describe('DashboardScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCategoryBudgets.mockResolvedValue({});
    mockGetCurrency.mockResolvedValue('USD');
    mockGetIncomesByMonth.mockResolvedValue([]);
    mockGetAllSavingsGoals.mockResolvedValue([]);
    mockGetReviewQueueCount.mockResolvedValue(0);
    mockGetHouseholdMembers.mockResolvedValue([]);
    mockEntitlements.isPremium = true;
    // First call = current month, second call (inside load()) = previous
    // month for the trend comparison — default both to empty unless a
    // test overrides.
    mockGetReceiptsByMonth.mockResolvedValue([]);
  });

  it('renders total spent and receipt count from a mocked receipt list', async () => {
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([
        makeReceipt({ id: 'r1', totalAmount: 20, storeName: 'Coffee Shop' }),
        makeReceipt({ id: 'r2', totalAmount: 30, storeName: 'Grocery Store', category: 'Groceries' }),
      ])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getAllByText('$50.00').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('2 expenses this month')).toBeTruthy();
  });

  it('shows budget progress for a custom category once something is added to it', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Subscriptions: 200 });
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([
        makeReceipt({ id: 's1', storeName: 'Netflix', totalAmount: 50, category: 'Subscriptions' }),
      ])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);
    await waitFor(() => expect(screen.getByText('$50.00 of $200.00')).toBeTruthy());
    expect(screen.getAllByText('Subscriptions').length).toBeGreaterThan(0);
    expect(screen.getByText('On track')).toBeTruthy();
  });

  it('counts a line-item category toward its own budget, split from the receipt total', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Subscriptions: 100 });
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([
        makeReceipt({
          id: 'mix',
          totalAmount: 100,
          category: 'Groceries',
          lineItems: [
            { id: 'a', name: 'Milk', amount: 60, category: 'Groceries' },
            { id: 'b', name: 'Streaming', amount: 40, category: 'Subscriptions' },
          ],
        }),
      ])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);
    await waitFor(() => expect(screen.getByText('$40.00 of $100.00')).toBeTruthy());
  });

  it('shows every budgeted category with spend, not just the top three', async () => {
    mockGetCategoryBudgets.mockResolvedValue({
      Groceries: 100,
      Dining: 100,
      Gas: 100,
      Subscriptions: 100,
    });
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([
        makeReceipt({ id: 'a', totalAmount: 40, category: 'Groceries' }),
        makeReceipt({ id: 'b', totalAmount: 30, category: 'Dining' }),
        makeReceipt({ id: 'c', totalAmount: 20, category: 'Gas' }),
        makeReceipt({ id: 'd', totalAmount: 10, category: 'Subscriptions' }),
      ])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);
    await waitFor(() => expect(screen.getByText('$10.00 of $100.00')).toBeTruthy());
    expect(screen.getAllByTestId('budget-ring')).toHaveLength(4);
  });

  it('Investments action opens the portfolio for Premium and the paywall for free users', async () => {
    render(<DashboardScreen />);
    await waitFor(() => screen.getByTestId('home-investments'));
    fireEvent.press(screen.getByTestId('home-investments'));
    expect(router.push).toHaveBeenCalledWith('/investments');
    expect(screen.getByText('Investments')).toBeTruthy();
  });

  it('Investments action routes free users to the paywall', async () => {
    mockEntitlements.isPremium = false;
    render(<DashboardScreen />);
    await waitFor(() => screen.getByTestId('home-investments'));
    fireEvent.press(screen.getByTestId('home-investments'));
    expect(router.push).toHaveBeenCalledWith('/paywall');
    expect(screen.getByText('Investments · Pro')).toBeTruthy();
  });

  it('shows a review banner linking to /review when expenses await review', async () => {
    mockGetReviewQueueCount.mockResolvedValue(3);
    render(<DashboardScreen />);
    await waitFor(() => {
      expect(screen.getByText('3 recurring expenses to review')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('review-banner'));
    expect(router.push).toHaveBeenCalledWith('/review');
  });

  it('hides the review banner when nothing awaits review', async () => {
    render(<DashboardScreen />);
    await waitFor(() => {
      expect(mockGetReviewQueueCount).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('review-banner')).toBeNull();
  });

  it('renders a recent-expenses row per receipt with its category', async () => {
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([
        makeReceipt({ id: 'r1', totalAmount: 20, storeName: 'Coffee Shop', category: 'Dining' }),
        makeReceipt({ id: 'r2', totalAmount: 30, storeName: 'Grocery Store', category: 'Groceries' }),
      ])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Coffee Shop')).toBeTruthy();
    });
    expect(screen.getByText('Grocery Store')).toBeTruthy();
    expect(screen.getByText(/Dining ·/)).toBeTruthy();
    expect(screen.getByText(/Groceries ·/)).toBeTruthy();
  });

  it('shows a budget row with its category when a budget is configured', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 100 });
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([makeReceipt({ id: 'r1', totalAmount: 40, category: 'Groceries' })])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Budgets')).toBeTruthy();
    });
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(screen.getByText('$40.00 of $100.00')).toBeTruthy();
    expect(screen.getByText('On track')).toBeTruthy();
  });

  it('tapping a budget chip or See all opens the Budgets page for the viewed month', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 100 });
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([makeReceipt({ id: 'r1', totalAmount: 40, category: 'Groceries' })])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);
    await waitFor(() => expect(screen.getByTestId('budget-chip-Groceries')).toBeTruthy());

    const now = new Date();
    const expected = {
      pathname: '/budgets',
      params: { year: String(now.getFullYear()), month: String(now.getMonth() + 1) },
    };
    fireEvent.press(screen.getByTestId('budget-chip-Groceries'));
    expect(router.push).toHaveBeenLastCalledWith(expected);
    fireEvent.press(screen.getByTestId('budgets-see-all'));
    expect(router.push).toHaveBeenLastCalledWith(expected);
  });

  it('shows the empty state when there are no receipts', async () => {
    mockGetReceiptsByMonth.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('No receipts yet')).toBeTruthy();
    });
  });

  it('shows the hero pace ring only when at least one budget is configured', async () => {
    // No budgets configured at all (default mock) — the pace ring has
    // nothing meaningful to show a percentage of, so it should be hidden.
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([makeReceipt({ id: 'r1', totalAmount: 20 })])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('1 expense this month')).toBeTruthy();
    });
    expect(screen.queryByTestId('pace-ring')).toBeNull();
  });

  it('shows the hero pace ring once a budget exists', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 100 });
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([makeReceipt({ id: 'r1', totalAmount: 40, category: 'Groceries' })])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('pace-ring')).toBeTruthy();
    });
    // 40 spent of a 100 total configured budget = 40%.
    expect(screen.getByText('40%')).toBeTruthy();
  });

  // Regression test for e1c552b: a large converted total (e.g. "CA$11726.55")
  // used to overflow the fixed-width hero row and clip/overlap the pace
  // ring. The fix wraps the amount in a shrinkable container and lets the
  // Text scale its own font down — this pins both halves of that fix:
  // the ring still renders fully, and the amount Text still carries the
  // shrink-to-fit props, so neither regresses silently later.
  it('shrinks the hero amount to fit instead of clipping the pace ring, for a large converted total', async () => {
    mockGetCurrency.mockResolvedValue('CAD');
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 8497.5 });
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([makeReceipt({ id: 'r1', totalAmount: 8497.5, category: 'Groceries' })])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    // 8497.5 USD * 1.38 CAD/USD = CA$11726.55 — the exact large total from
    // the real device screenshot that exposed this bug. The same string
    // also shows up in the budget row and the recent-expenses row (same
    // amount, unrelated Text nodes), so disambiguate by picking the one
    // wrapped in adjustsFontSizeToFit — that's the hero amount.
    await waitFor(() => {
      expect(screen.getAllByText('CA$11726.55').length).toBeGreaterThan(0);
    });
    const amountText = screen
      .getAllByText('CA$11726.55')
      .find((node) => node.props.adjustsFontSizeToFit);
    expect(amountText).toBeTruthy();
    expect(amountText!.props.numberOfLines).toBe(1);
    expect(amountText!.props.adjustsFontSizeToFit).toBe(true);

    // The pace ring (spent == budget, so 100% of budget) must still be
    // fully rendered alongside the shrunk amount, not clipped or hidden.
    expect(screen.getByTestId('pace-ring')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('of budget')).toBeTruthy();
  });

  it('shows the "Where it went" composition bar only when there is category spend', async () => {
    mockGetReceiptsByMonth.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('No receipts yet')).toBeTruthy();
    });
    expect(screen.queryByText('Where it went')).toBeNull();

    mockGetReceiptsByMonth
      .mockResolvedValueOnce([
        makeReceipt({ id: 'r1', totalAmount: 20, category: 'Dining' }),
        makeReceipt({ id: 'r2', totalAmount: 30, category: 'Groceries' }),
      ])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getAllByText('Where it went')[0]).toBeTruthy();
    });
  });

  it('renders each budget as its own ring chip instead of a linear bar', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 100, Dining: 50 });
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([
        makeReceipt({ id: 'r1', totalAmount: 40, category: 'Groceries' }),
        makeReceipt({ id: 'r2', totalAmount: 10, category: 'Dining' }),
      ])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeTruthy();
    });
    expect(screen.getAllByTestId('budget-ring')).toHaveLength(2);
  });

  // app/(tabs)/index.tsx gives its card surfaces (budgetCard, the
  // recent-expenses row, etc.) BOTH an iOS shadow key set
  // (shadowColor/shadowOffset/shadowOpacity/shadowRadius) and Android's
  // `elevation` on the same style object — RN itself picks the relevant
  // half per platform at native render time, so there's no Platform.OS
  // branch in JS to assert per-OS. What the restyle CAN silently drop is
  // one half of that pair; this pins down that both are still present
  // together, asserting only that the right keys exist (not their
  // literal shadow/elevation values).
  it('gives both the budget card and the recent-expenses row the full cross-platform shadow key set', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 100 });
    mockGetReceiptsByMonth
      .mockResolvedValueOnce([
        makeReceipt({ id: 'r1', totalAmount: 40, storeName: 'Coffee Shop', category: 'Groceries' }),
      ])
      .mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Groceries')).toBeTruthy();
    });

    const budgetCardStyle = nearestCardAncestorStyle(screen.getByText('Groceries'));
    expect(budgetCardStyle).toEqual(
      expect.objectContaining({
        shadowColor: expect.anything(),
        shadowOffset: expect.anything(),
        shadowOpacity: expect.anything(),
        shadowRadius: expect.anything(),
        elevation: expect.anything(),
      }),
    );

    const rowCardStyle = nearestCardAncestorStyle(screen.getByText('Coffee Shop'));
    expect(rowCardStyle).toEqual(
      expect.objectContaining({
        shadowColor: expect.anything(),
        shadowOffset: expect.anything(),
        shadowOpacity: expect.anything(),
        shadowRadius: expect.anything(),
        elevation: expect.anything(),
      }),
    );
  });

  it('opens all incomes when earned is tapped and by-person when the bars are tapped', async () => {
    mockGetIncomesByMonth.mockResolvedValue([
      {
        id: 'i1',
        sourceName: 'Payroll',
        date: new Date().toISOString().slice(0, 10),
        amountUsd: 1000,
        category: 'Salary',
        earnedBy: 'uid-self',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    mockGetReceiptsByMonth.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByTestId('cashflow-earned')).toBeTruthy();
    });
    fireEvent.press(screen.getByTestId('cashflow-earned'));
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/incomes',
      }),
    );
    fireEvent.press(screen.getByTestId('cashflow-bars'));
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/incomes',
      }),
    );
  });

  it('shows savings-goal progress and a Goals action when envelopes exist', async () => {
    mockGetAllSavingsGoals.mockResolvedValue([
      {
        id: 'g1',
        name: 'Emergency fund',
        targetUsd: 1000,
        allocatedUsd: 250,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ]);
    mockGetReceiptsByMonth.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('Emergency fund')).toBeTruthy();
    });
    expect(screen.getByText('$250.00 of $1000.00')).toBeTruthy();
    expect(screen.getByText('Goals')).toBeTruthy();
    fireEvent.press(screen.getByText('Goals'));
    expect(router.push).toHaveBeenCalledWith('/savings-goals');
  });

  it('sends a free-tier user to the paywall instead of Goals', async () => {
    mockEntitlements.isPremium = false;
    mockGetReceiptsByMonth.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    render(<DashboardScreen />);
    await waitFor(() => {
      expect(screen.getByText('Goals · Pro')).toBeTruthy();
    });
    fireEvent.press(screen.getByText('Goals · Pro'));
    expect(router.push).toHaveBeenCalledWith('/paywall');
  });

  it('labels the manual-entry action Add expense', async () => {
    mockGetReceiptsByMonth.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    render(<DashboardScreen />);
    await waitFor(() => {
      expect(screen.getByText('Add expense')).toBeTruthy();
    });
    expect(screen.queryByText('Add manually')).toBeNull();
  });

  it('slices the income bar by earner, naming each with their share', async () => {
    mockGetHouseholdMembers.mockResolvedValue([
      { uid: 'uid-self', displayName: 'Alex', isYou: true },
      { uid: 'uid-partner', displayName: 'Sudesna Karak', isYou: false },
    ]);
    mockGetIncomesByMonth.mockResolvedValue([
      {
        id: 'i1',
        sourceName: 'Payroll',
        date: new Date().toISOString().slice(0, 10),
        amountUsd: 7200,
        category: 'Salary',
        earnedBy: 'uid-self',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'i2',
        sourceName: 'Payroll',
        date: new Date().toISOString().slice(0, 10),
        amountUsd: 6400,
        category: 'Salary',
        earnedBy: 'uid-partner',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    mockGetReceiptsByMonth.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    render(<DashboardScreen />);

    await waitFor(() => {
      expect(screen.getByText('You 53%')).toBeTruthy();
    });
    expect(screen.getByText('Sudesna Karak 47%')).toBeTruthy();
    expect(screen.queryByText(/Tap earned for all incomes/)).toBeNull();
  });
});
