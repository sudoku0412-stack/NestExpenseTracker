export const SERIES = ['#4f8ef7', '#9b6bf2', '#f2b544', '#2db5a3', '#e9738a', '#8e96aa', '#3dbe6c', '#d9822b', '#5ec4e6', '#c26bd6'];
export const INCOME_COLORS: Record<string, string> = {
  Salary: '#4f8ef7', Freelance: '#9b6bf2', Gift: '#f2b544', Interest: '#2db5a3',
  Refund: '#8e96aa', InvestmentReturn: '#3dbe6c', Other: '#e9738a',
};
export const INCOME_LABELS: Record<string, string> = {
  Salary: 'Salary', Freelance: 'Freelance', Gift: 'Gift', Interest: 'Interest',
  Refund: 'Refund', InvestmentReturn: 'Investment return', Other: 'Other',
};
export const STATUS_COLOR = { onTrack: 'var(--brand)', watch: 'var(--warn)', over: 'var(--bad)' } as const;
export const STATUS_CLASS = { onTrack: 'ok', watch: 'watch', over: 'over' } as const;
