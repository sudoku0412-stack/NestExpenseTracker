import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../constants/theme';
import { I18nProvider } from '../../lib/I18nContext';
import { EarningsInvestmentsCard } from '../../components/ui/EarningsInvestmentsCard';
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

describe('EarningsInvestmentsCard', () => {
  const cash = computeCashflow(
    [income('pay', 'Salary', 3000), income('div', 'InvestmentReturn', 1000)],
    [],
  );

  it('shows income by type and investments by kind in one card', () => {
    wrap(<EarningsInvestmentsCard cashflow={cash} accounts={[account(1200, 1000)]} currency="USD" />);
    expect(screen.getByText('Total earnings and investments')).toBeTruthy();
    expect(screen.getByText('Salary 75%')).toBeTruthy();
    expect(screen.getByText('Investment return 25%')).toBeTruthy();
    expect(screen.getByText('$4000.00 total')).toBeTruthy();
    expect(screen.getByText('Stocks 100%')).toBeTruthy();
    expect(screen.getByText('$1200.00 total')).toBeTruthy();
    expect(screen.getByTestId('earnings-investments-gain')).toHaveTextContent('Gain +$200.00 (+20.0%)');
  });

  it('income only: no investments section', () => {
    wrap(<EarningsInvestmentsCard cashflow={cash} accounts={[]} currency="USD" />);
    expect(screen.getByTestId('earnings-income')).toBeTruthy();
    expect(screen.queryByTestId('earnings-investments-section')).toBeNull();
  });

  it('investments only: no income section; tapping opens investments', () => {
    const onPress = jest.fn();
    wrap(
      <EarningsInvestmentsCard
        cashflow={computeCashflow([], [])}
        accounts={[account(1200, 1000)]}
        currency="USD"
        onPressInvestments={onPress}
      />,
    );
    expect(screen.queryByTestId('earnings-income')).toBeNull();
    fireEvent.press(screen.getByTestId('earnings-investments-section'));
    expect(onPress).toHaveBeenCalled();
  });

  it('renders nothing with neither', () => {
    wrap(<EarningsInvestmentsCard cashflow={computeCashflow([], [])} accounts={[]} currency="USD" />);
    expect(screen.queryByTestId('earnings-investments')).toBeNull();
  });

  it('slices the income bar by person and opens that person\'s incomes on tap', () => {
    const onPressIncome = jest.fn();
    const two = computeCashflow(
      [
        { ...income('a', 'Salary', 3600), earnedBy: 'uid-me' },
        { ...income('b', 'Salary', 3200), earnedBy: 'uid-partner' },
      ],
      [],
    );
    wrap(
      <EarningsInvestmentsCard
        cashflow={two}
        accounts={[]}
        currency="USD"
        members={[
          { uid: 'uid-me', displayName: 'Kaushik', isYou: true },
          { uid: 'uid-partner', displayName: 'Sudesna Karak', isYou: false },
        ] as never}
        onPressIncome={onPressIncome}
      />,
    );
    expect(screen.getByText('You 53%')).toBeTruthy();
    expect(screen.getByText('Sudesna Karak 47%')).toBeTruthy();
    expect(screen.getByTestId('earnings-types')).toHaveTextContent('Salary 100%');
    fireEvent.press(screen.getByTestId('earnings-member-uid-partner'));
    expect(onPressIncome).toHaveBeenLastCalledWith('uid-partner');
    fireEvent.press(screen.getByTestId('earnings-income-head'));
    expect(onPressIncome).toHaveBeenLastCalledWith();
  });

  it('single earner shows no member rows', () => {
    wrap(<EarningsInvestmentsCard cashflow={cash} accounts={[]} currency="USD" members={[] as never} />);
    expect(screen.queryByTestId('earnings-members')).toBeNull();
  });

  it('labels an unknown long uid with a truncated fallback, not a blank slice', () => {
    const two = computeCashflow(
      [
        { ...income('a', 'Salary', 1000), earnedBy: 'uid-me' },
        { ...income('b', 'Salary', 1000), earnedBy: 'abcdefghijk' },
      ],
      [],
    );
    wrap(
      <EarningsInvestmentsCard
        cashflow={two}
        accounts={[]}
        currency="USD"
        members={[{ uid: 'uid-me', displayName: 'Alex', isYou: true }] as never}
      />,
    );
    expect(screen.getByText('You 50%')).toBeTruthy();
    expect(screen.getByText('abcdef… 50%')).toBeTruthy();
  });
});
