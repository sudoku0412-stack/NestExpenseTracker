import { budgetStatus, computeBudgetOverview } from '../lib/budgetOverview';

describe('budgetStatus', () => {
  it('uses the 70% / 90% thresholds', () => {
    expect(budgetStatus(70, 100)).toBe('onTrack');
    expect(budgetStatus(71, 100)).toBe('watch');
    expect(budgetStatus(90, 100)).toBe('watch');
    expect(budgetStatus(91, 100)).toBe('over');
    expect(budgetStatus(5, 0)).toBe('onTrack');
  });
});

describe('computeBudgetOverview', () => {
  it('lists only budgeted categories, biggest limit first, with spent/left/ratio', () => {
    const o = computeBudgetOverview(
      { Groceries: 600, Dining: 250, Travel: 0, Gas: 160 },
      { Groceries: 150, Dining: 300, Travel: 80, Electronics: 40 },
    );
    expect(o.lines.map((l) => l.category)).toEqual(['Groceries', 'Dining', 'Gas']);
    const dining = o.lines[1];
    expect(dining).toMatchObject({ spent: 300, limit: 250, left: -50, ratio: 1, status: 'over' });
    expect(o.lines[2]).toMatchObject({ spent: 0, left: 160, ratio: 0 });
  });

  it('total left subtracts spend; room left ignores overspent categories', () => {
    const o = computeBudgetOverview({ Groceries: 600, Dining: 250 }, { Groceries: 150, Dining: 300 });
    expect(o.totalBudget).toBe(850);
    expect(o.totalSpent).toBe(450);
    expect(o.leftOfTotal).toBe(400); // 850 - 450
    expect(o.leftAcrossBudgets).toBe(450); // 450 left in Groceries, 0 in Dining
  });

  it('is empty without budgets', () => {
    expect(computeBudgetOverview({}, { Groceries: 10 })).toMatchObject({
      lines: [],
      totalBudget: 0,
      leftOfTotal: 0,
      leftAcrossBudgets: 0,
    });
  });

  it('counts every budget in the totals, Recurring included', () => {
    const o = computeBudgetOverview(
      { Groceries: 600, Subscriptions: 200, Recurring: 5000 },
      { Groceries: 150, Subscriptions: 140, Recurring: 246.5 },
    );
    expect(o.lines.map((l) => l.category)).toEqual(['Recurring', 'Groceries', 'Subscriptions']);
    expect(o.totalBudget).toBe(5800);
    expect(o.totalSpent).toBe(536.5);
    expect(o.leftOfTotal).toBe(5263.5);
    expect(o.leftAcrossBudgets).toBe(5263.5);
  });
});
