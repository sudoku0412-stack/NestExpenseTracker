import { IncomeCategory } from '../types';
import { categoryLabel } from '../lib/categoryLabel';
import { tr, type TranslationKey } from '../lib/i18n';

export const INCOME_CATEGORY_ICONS: Record<IncomeCategory, string> = {
  Salary: '💼',
  Freelance: '🖥️',
  Gift: '🎁',
  Interest: '🏦',
  Refund: '↩️',
  InvestmentReturn: '📈',
  Other: '✨',
};

export const ALL_INCOME_CATEGORIES: IncomeCategory[] = [
  'Salary',
  'Freelance',
  'Gift',
  'Interest',
  'Refund',
  'InvestmentReturn',
  'Other',
];

/** Placeholder for the free-text source name field, keyed by type. */
export function sourceNamePlaceholder(category: IncomeCategory): string {
  const key = `sourcePlaceholder_${category}` as TranslationKey;
  return tr(key);
}

export function incomeCategoryLabel(category: IncomeCategory): string {
  return categoryLabel(category);
}

/** Segment colors for the income-by-type breakdown (Home + Reports). */
export const INCOME_CATEGORY_COLORS: Record<IncomeCategory, string> = {
  Salary: '#4F8EF7',
  Freelance: '#9B6BF2',
  Gift: '#F2B544',
  Interest: '#2DB5A3',
  Refund: '#8E96AA',
  InvestmentReturn: '#3DBE6C',
  Other: '#E9738A',
};

export function incomeCategoryColor(category: string, fallback: string): string {
  return INCOME_CATEGORY_COLORS[category as IncomeCategory] ?? fallback;
}
