import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { I18nProvider } from '../../lib/I18nContext';
import { IncomeBreakdownCard } from '../../components/ui/IncomeBreakdownCard';
import { InvestmentSnapshotCard } from '../../components/ui/InvestmentSnapshotCard';
import { computeCashflow } from '../../lib/cashflowStats';
import type { Income, InvestmentAccount } from '../../types';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const wrap = (ui: React.ReactElement) =>
  render(
    <ThemeProvider>
      <I18nProvider>{ui}</I18nProvider>
    </ThemeProvider>,
  );

const income = (id: string, category: Income['category'], amountUsd: number): Income => ({
  id,
  sourceName: id,
  date: '2026-10-01',
  amountUsd,
  category,
  earnedBy: 'u1',
  createdAt: 'c',
  updatedAt: 'c',
});

const account = (valueUsd: number, contributedUsd: number): InvestmentAccount => ({
  id: 'a1',
  name: 'TFSA',
  kind: 'stocks',
  contributedUsd,
  valueUsd,
  createdAt: 'c',
  updatedAt: 'c',
});

describe('IncomeBreakdownCard', () => {
  it('shows each income type with its amount and share, investment return included in total', () => {
    const cashflow = computeCashflow(
      [income('pay', 'Salary', 3000), income('div', 'InvestmentReturn', 1000)],
      [],
    );
    wrap(<IncomeBreakdownCard cashflow={cashflow} currency="USD" />);
    expect(screen.getByTestId('income-breakdown-Salary')).toBeTruthy();
    expect(screen.getByTestId('income-breakdown-InvestmentReturn')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();
    expect(screen.getByText('$4000.00 total')).toBeTruthy();
  });

  it('renders nothing without income', () => {
    wrap(<IncomeBreakdownCard cashflow={computeCashflow([], [])} currency="USD" />);
    expect(screen.queryByTestId('income-breakdown')).toBeNull();
  });
});

describe('InvestmentSnapshotCard', () => {
  it('shows value, contributed and gain, and opens on press', () => {
    const onPress = jest.fn();
    wrap(<InvestmentSnapshotCard accounts={[account(1200, 1000)]} currency="USD" onPress={onPress} />);
    expect(screen.getByText('$1200.00')).toBeTruthy();
    expect(screen.getByText('$1000.00')).toBeTruthy();
    expect(screen.getByTestId('investment-snapshot-gain')).toHaveTextContent('+$200.00 (+20.0%)');
    fireEvent.press(screen.getByTestId('investment-snapshot'));
    expect(onPress).toHaveBeenCalled();
  });

  it('renders nothing with no accounts', () => {
    wrap(<InvestmentSnapshotCard accounts={[]} currency="USD" />);
    expect(screen.queryByTestId('investment-snapshot')).toBeNull();
  });
});
