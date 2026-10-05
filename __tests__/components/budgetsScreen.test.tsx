import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: mockPush }),
  useLocalSearchParams: () => ({ year: '2026', month: '10' }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

const mockGetReceiptsByMonth = jest.fn();
jest.mock('../../lib/database', () => ({
  getReceiptsByMonth: (...a: unknown[]) => mockGetReceiptsByMonth(...a),
  getCurrentHouseholdId: () => 'hh1',
}));
const mockGetBudgets = jest.fn();
jest.mock('../../lib/secureStorage', () => ({
  getCategoryBudgets: () => mockGetBudgets(),
  getCurrency: jest.fn(async () => 'USD'),
}));
jest.mock('../../lib/customCategories', () => ({
  getCustomCategories: jest.fn(async () => []),
  resolveCategoryColor: () => '#4F8EF7',
}));

import BudgetsScreen from '../../app/budgets';

const receipt = (id: string, category: string, totalAmount: number) =>
  ({ id, storeName: id, date: '2026-10-02', totalAmount, category, createdAt: 'c', updatedAt: 'c' }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetReceiptsByMonth.mockResolvedValue([]);
  mockGetBudgets.mockResolvedValue({});
});

describe('BudgetsScreen', () => {
  it('loads the month from the route params', async () => {
    mockGetBudgets.mockResolvedValue({ Groceries: 600 });
    render(<BudgetsScreen />);
    await waitFor(() => expect(mockGetReceiptsByMonth).toHaveBeenCalledWith(2026, 10));
  });

  it('shows each budgeted category with spent, left and totals', async () => {
    mockGetBudgets.mockResolvedValue({ Groceries: 600, Dining: 250, Gas: 0 });
    mockGetReceiptsByMonth.mockResolvedValue([receipt('a', 'Groceries', 150), receipt('b', 'Dining', 300)]);
    render(<BudgetsScreen />);

    await waitFor(() => expect(screen.getByTestId('budget-row-Groceries')).toBeTruthy());
    expect(screen.queryByTestId('budget-row-Gas')).toBeNull(); // no budget set
    expect(screen.getByText('$150.00 of $600.00')).toBeTruthy();
    expect(screen.getByTestId('budget-left-Groceries')).toHaveTextContent('$450.00 left');
    expect(screen.getByTestId('budget-left-Dining')).toHaveTextContent('Over by $50.00');
    expect(screen.getByTestId('budgets-left-total')).toHaveTextContent('$400.00'); // 850 - 450
    expect(screen.getByTestId('budgets-total')).toHaveTextContent('$850.00');
    expect(screen.getByText('Left of total budget')).toBeTruthy();
  });

  it('flags when the whole budget is exceeded', async () => {
    mockGetBudgets.mockResolvedValue({ Dining: 100 });
    mockGetReceiptsByMonth.mockResolvedValue([receipt('b', 'Dining', 130)]);
    render(<BudgetsScreen />);
    await waitFor(() => expect(screen.getByText('Over total budget')).toBeTruthy());
    expect(screen.getByTestId('budgets-left-total')).toHaveTextContent('$30.00');
    expect(screen.getByTestId('budgets-total')).toHaveTextContent('$100.00');
  });

  it('Manage opens Settings on that category; Edit all opens the budgets section', async () => {
    mockGetBudgets.mockResolvedValue({ Groceries: 600 });
    render(<BudgetsScreen />);
    await waitFor(() => screen.getByTestId('budget-manage-Groceries'));

    fireEvent.press(screen.getByTestId('budget-manage-Groceries'));
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/settings',
      params: { section: 'budgets', category: 'Groceries' },
    });
    fireEvent.press(screen.getByTestId('budgets-manage-all'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/settings', params: { section: 'budgets' } });
  });

  it('with no budgets shows an empty state that leads to Settings', async () => {
    render(<BudgetsScreen />);
    await waitFor(() => expect(screen.getByText('No budgets yet')).toBeTruthy());
    fireEvent.press(screen.getByText('Set budgets'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/settings', params: { section: 'budgets' } });
  });

  it('includes Recurring in the summary totals', async () => {
    mockGetBudgets.mockResolvedValue({ Groceries: 600, Recurring: 5000 });
    mockGetReceiptsByMonth.mockResolvedValue([receipt('a', 'Groceries', 150)]);
    render(<BudgetsScreen />);
    await waitFor(() => expect(screen.getByTestId('budget-row-Recurring')).toBeTruthy());
    expect(screen.getByTestId('budgets-left-total')).toHaveTextContent('$5450.00'); // 5600 - 150
    expect(screen.getByText('$150.00 of $5600.00')).toBeTruthy();
  });

  it('colors each row\'s left amount by status: green on track, accent watch, red over', async () => {
    mockGetBudgets.mockResolvedValue({ Groceries: 1000, Dining: 100, Gas: 100, Travel: 100 });
    mockGetReceiptsByMonth.mockResolvedValue([
      receipt('a', 'Groceries', 100), // 10% -> on track
      receipt('b', 'Dining', 80), // 80% -> watch
      receipt('c', 'Gas', 120), // 120% -> over
    ]);
    render(<BudgetsScreen />);
    await waitFor(() => screen.getByTestId('budget-left-Groceries'));
    const colorOf = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style).color;
    const onTrack = colorOf('budget-left-Groceries');
    const watch = colorOf('budget-left-Dining');
    const over = colorOf('budget-left-Gas');
    expect(new Set([onTrack, watch, over]).size).toBe(3);
    expect(colorOf('budget-left-Travel')).toBe(onTrack); // untouched budget is on track
  });
});
