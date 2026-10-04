import { computeCashflow } from '../lib/cashflowStats';
import { Income, Receipt } from '../types';

const baseReceipt = (overrides: Partial<Receipt>): Receipt => ({
  id: 'r1',
  storeName: 'Test',
  date: '2026-03-01',
  totalAmount: 0,
  category: 'Other',
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  ...overrides,
});

const baseIncome = (overrides: Partial<Income>): Income => ({
  id: 'i1',
  sourceName: 'Payroll',
  date: '2026-03-01',
  amountUsd: 0,
  category: 'Salary',
  earnedBy: 'uid-a',
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  ...overrides,
});

describe('computeCashflow', () => {
  it('returns zeros for empty incomes and receipts', () => {
    const s = computeCashflow([], []);
    expect(s.totalEarned).toBe(0);
    expect(s.totalSpent).toBe(0);
    expect(s.net).toBe(0);
    expect(s.incomeCount).toBe(0);
    expect(s.investedUsd).toBe(0);
    expect(s.consumedUsd).toBe(0);
    expect(s.savingsRate).toBeNull();
    expect(s.byMember).toEqual([]);
    expect(s.byCategory).toEqual([]);
  });

  it('computes earned, spent, and net', () => {
    const incomes = [
      baseIncome({ id: 'i1', amountUsd: 1000, earnedBy: 'a' }),
      baseIncome({ id: 'i2', amountUsd: 250, earnedBy: 'b', category: 'Freelance' }),
    ];
    const receipts = [
      baseReceipt({ id: 'r1', totalAmount: 400 }),
      baseReceipt({ id: 'r2', totalAmount: 100, category: 'Investments' }),
    ];
    const s = computeCashflow(incomes, receipts);
    expect(s.totalEarned).toBe(1250);
    expect(s.totalSpent).toBe(500);
    expect(s.net).toBe(750);
    expect(s.incomeCount).toBe(2);
    expect(s.investedUsd).toBe(100);
    expect(s.consumedUsd).toBe(400);
    expect(s.savingsRate).toBeCloseTo(100 / 1250);
  });

  it('rolls up byMember sorted by total desc', () => {
    const incomes = [
      baseIncome({ id: 'i1', amountUsd: 100, earnedBy: 'uid-low' }),
      baseIncome({ id: 'i2', amountUsd: 500, earnedBy: 'uid-high' }),
      baseIncome({ id: 'i3', amountUsd: 50, earnedBy: 'uid-low', category: 'Gift' }),
    ];
    const s = computeCashflow(incomes, []);
    expect(s.byMember).toEqual([
      { earnedBy: 'uid-high', total: 500, count: 1 },
      { earnedBy: 'uid-low', total: 150, count: 2 },
    ]);
  });

  it('rolls up byCategory sorted by total desc', () => {
    const incomes = [
      baseIncome({ id: 'i1', amountUsd: 200, category: 'Salary', earnedBy: 'a' }),
      baseIncome({
        id: 'i2',
        amountUsd: 50,
        category: 'Interest',
        earnedBy: 'a',
      }),
      baseIncome({
        id: 'i3',
        amountUsd: 200,
        category: 'Salary',
        earnedBy: 'b',
      }),
    ];
    const s = computeCashflow(incomes, []);
    expect(s.byCategory).toEqual([
      { category: 'Salary', total: 400, count: 2 },
      { category: 'Interest', total: 50, count: 1 },
    ]);
  });

  it('allows negative net when spending exceeds income', () => {
    const s = computeCashflow(
      [baseIncome({ amountUsd: 100 })],
      [baseReceipt({ totalAmount: 300 })],
    );
    expect(s.net).toBe(-200);
  });

  it('counts Investments via categoryTags even when the primary category is custom', () => {
    const s = computeCashflow(
      [baseIncome({ amountUsd: 200 })],
      [
        baseReceipt({
          id: 'r-tag',
          totalAmount: 80,
          category: 'Brokerage',
          categoryTags: ['Brokerage', 'Investments'],
        }),
      ],
    );
    expect(s.investedUsd).toBe(80);
    expect(s.consumedUsd).toBe(0);
    expect(s.savingsRate).toBeCloseTo(80 / 200);
  });

  it('does not treat a custom tag that is not Investments as invested spend', () => {
    const s = computeCashflow(
      [baseIncome({ amountUsd: 200 })],
      [baseReceipt({ totalAmount: 80, category: 'Brokerage', categoryTags: ['Brokerage'] })],
    );
    expect(s.investedUsd).toBe(0);
    expect(s.consumedUsd).toBe(80);
  });

  it('uses unknown / Other buckets and a null savings rate when earned is 0', () => {
    const s = computeCashflow(
      [baseIncome({ amountUsd: 50, earnedBy: '', category: '' as Income['category'] })],
      [baseReceipt({ totalAmount: 10, category: 'Investments' })],
    );
    expect(s.byMember).toEqual([{ earnedBy: 'unknown', total: 50, count: 1 }]);
    expect(s.byCategory).toEqual([{ category: 'Other', total: 50, count: 1 }]);

    const noEarn = computeCashflow([], [baseReceipt({ totalAmount: 10, category: 'Investments' })]);
    expect(noEarn.savingsRate).toBeNull();
    expect(noEarn.investedUsd).toBe(10);
  });
});
