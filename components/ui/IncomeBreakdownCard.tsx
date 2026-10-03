import React from 'react';
import { Text, View } from 'react-native';
import { Theme, useStyles, useTheme } from '../../constants/theme';
import { INCOME_CATEGORY_ICONS, incomeCategoryColor, incomeCategoryLabel } from '../../constants/incomeCategories';
import { formatCurrency, type CurrencyCode } from '../../lib/currency';
import { useT } from '../../lib/I18nContext';
import type { CashflowStats, IncomeCategory } from '../../types';

const makeStyles = (t: Theme) => ({
  card: {
    backgroundColor: t.colors.cardTint.sky,
    borderRadius: 18,
    padding: t.spacing.md,
    borderWidth: t.isDark ? 0 : 1,
    borderColor: t.colors.border,
    gap: 10,
  },
  head: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'baseline' as const,
  },
  title: {
    fontFamily: t.fonts.display.bold,
    fontSize: t.font.sm,
    color: t.colors.textPrimary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  note: { fontFamily: t.fonts.body.regular, fontSize: t.font.xs, color: t.colors.textMuted },
  bar: {
    flexDirection: 'row' as const,
    height: 8,
    borderRadius: t.radius.full,
    overflow: 'hidden' as const,
    gap: 1.5,
  },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  dot: { width: 8, height: 8, borderRadius: t.radius.full },
  rowLabel: {
    flex: 1,
    fontFamily: t.fonts.body.regular,
    fontSize: t.font.sm,
    color: t.colors.textSecondary,
  },
  rowAmount: { fontFamily: t.fonts.mono.medium, fontSize: t.font.sm, color: t.colors.textPrimary },
  rowPct: {
    width: 40,
    textAlign: 'right' as const,
    fontFamily: t.fonts.body.regular,
    fontSize: t.font.xs,
    color: t.colors.textMuted,
  },
});

/** "Where it came from": the month's income split by type (salary,
 *  freelance, investment return, …) as a bar plus a legend with amounts.
 *  Renders nothing when there is no income. */
export function IncomeBreakdownCard({
  cashflow,
  currency,
}: {
  cashflow: CashflowStats;
  currency: CurrencyCode;
}) {
  const t = useT();
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const total = cashflow.totalEarned;
  if (cashflow.byCategory.length === 0 || total <= 0) return null;
  return (
    <View style={styles.card} testID="income-breakdown">
      <View style={styles.head}>
        <Text style={styles.title}>{t('whereItCameFrom')}</Text>
        <Text style={styles.note}>{t('amountTotal', { amount: formatCurrency(total, currency) })}</Text>
      </View>
      <View style={styles.bar}>
        {cashflow.byCategory.map((c) => (
          <View
            key={c.category}
            style={{
              flex: Math.max(c.total, 0.001),
              backgroundColor: incomeCategoryColor(c.category, theme.colors.accent),
            }}
          />
        ))}
      </View>
      {cashflow.byCategory.map((c) => {
        const cat = c.category as IncomeCategory;
        return (
          <View key={c.category} style={styles.row} testID={`income-breakdown-${c.category}`}>
            <View style={[styles.dot, { backgroundColor: incomeCategoryColor(c.category, theme.colors.accent) }]} />
            <Text style={styles.rowLabel} numberOfLines={1}>
              {INCOME_CATEGORY_ICONS[cat] ?? ''} {incomeCategoryLabel(cat)}
            </Text>
            <Text style={styles.rowAmount}>{formatCurrency(c.total, currency)}</Text>
            <Text style={styles.rowPct}>{Math.round((c.total / total) * 100)}%</Text>
          </View>
        );
      })}
    </View>
  );
}
