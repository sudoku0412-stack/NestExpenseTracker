import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Theme, useStyles, useTheme } from '../../constants/theme';
import { incomeCategoryColor, incomeCategoryLabel } from '../../constants/incomeCategories';
import { formatCurrency, type CurrencyCode } from '../../lib/currency';
import { useT } from '../../lib/I18nContext';
import { gainLabel, INVESTMENT_KIND_KEYS, summarizeInvestments } from '../../lib/investments';
import type { CashflowStats, IncomeCategory, InvestmentAccount, InvestmentKind } from '../../types';

const KIND_COLORS: Record<InvestmentKind, string> = {
  stocks: '#4F8EF7',
  etf: '#9B6BF2',
  crypto: '#F2B544',
  retirement: '#2DB5A3',
  savings: '#3DBE6C',
  other: '#8E96AA',
};

const makeStyles = (t: Theme) => ({
  card: {
    backgroundColor: t.colors.cardTint.sky,
    borderRadius: 18,
    padding: t.spacing.md,
    borderWidth: t.isDark ? 0 : 1,
    borderColor: t.colors.border,
    shadowColor: t.isDark ? '#000' : '#0C0F24',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: t.isDark ? 0.4 : 0.08,
    shadowRadius: 10,
    elevation: 2,
    gap: 14,
  },
  title: {
    fontFamily: t.fonts.display.bold,
    fontSize: t.font.sm,
    color: t.colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  head: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'baseline' as const,
    marginBottom: 9,
  },
  note: { fontFamily: t.fonts.body.regular, fontSize: t.font.xs, color: t.colors.textMuted },
  bar: {
    flexDirection: 'row' as const,
    height: 8,
    borderRadius: t.radius.full,
    overflow: 'hidden' as const,
    gap: 1.5,
  },
  legend: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10, marginTop: 9 },
  legendItem: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5 },
  dot: { width: 7, height: 7, borderRadius: t.radius.full },
  legendText: {
    fontFamily: t.fonts.body.regular,
    fontSize: t.font.xs,
    color: t.colors.textSecondary,
  },
  gain: { marginTop: 8, fontFamily: t.fonts.mono.medium, fontSize: t.font.xs },
});

/** One card for what came in: this month's income split by type, and
 *  (Premium) the investment portfolio split by kind with its gain. Same
 *  bar + dot legend look as "Where it went". Renders nothing when there
 *  is neither income nor investments. */
export function EarningsInvestmentsCard({
  cashflow,
  accounts,
  currency,
  onPressInvestments,
}: {
  cashflow: CashflowStats;
  accounts: InvestmentAccount[];
  currency: CurrencyCode;
  onPressInvestments?: () => void;
}) {
  const t = useT();
  const theme = useTheme();
  const styles = useStyles(makeStyles);

  const earned = cashflow.totalEarned;
  const incomeRows = earned > 0 ? cashflow.byCategory : [];

  const summary = summarizeInvestments(accounts);
  const byKind = new Map<InvestmentKind, number>();
  for (const a of accounts) byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + a.valueUsd);
  const kindRows = [...byKind.entries()]
    .filter(([, v]) => v > 0)
    .map(([kind, total]) => ({ kind, total }))
    .sort((a, b) => b.total - a.total);

  if (incomeRows.length === 0 && accounts.length === 0) return null;

  const gainColor =
    summary.gainUsd > 0 ? theme.colors.success : summary.gainUsd < 0 ? theme.colors.error : theme.colors.textSecondary;

  return (
    <View style={styles.card} testID="earnings-investments">
      <Text style={styles.title}>{t('earningsAndInvestments')}</Text>

      {incomeRows.length > 0 ? (
        <View testID="earnings-income">
          <View style={styles.head}>
            <Text style={styles.legendText}>{t('income')}</Text>
            <Text style={styles.note}>{t('amountTotal', { amount: formatCurrency(earned, currency) })}</Text>
          </View>
          <View style={styles.bar}>
            {incomeRows.map((c) => (
              <View
                key={c.category}
                style={{
                  flex: Math.max(c.total, 0.001),
                  backgroundColor: incomeCategoryColor(c.category, theme.colors.accent),
                }}
              />
            ))}
          </View>
          <View style={styles.legend}>
            {incomeRows.map((c) => (
              <View key={c.category} style={styles.legendItem} testID={`earnings-income-${c.category}`}>
                <View style={[styles.dot, { backgroundColor: incomeCategoryColor(c.category, theme.colors.accent) }]} />
                <Text style={styles.legendText}>
                  {incomeCategoryLabel(c.category as IncomeCategory)} {Math.round((c.total / earned) * 100)}%
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {accounts.length > 0 ? (
        <TouchableOpacity
          testID="earnings-investments-section"
          onPress={onPressInvestments}
          disabled={!onPressInvestments}
          accessibilityRole="button"
        >
          <View style={styles.head}>
            <Text style={styles.legendText}>{t('investmentsTitle')}</Text>
            <Text style={styles.note}>{t('amountTotal', { amount: formatCurrency(summary.valueUsd, currency) })}</Text>
          </View>
          {kindRows.length > 0 ? (
            <>
              <View style={styles.bar}>
                {kindRows.map((k) => (
                  <View key={k.kind} style={{ flex: k.total, backgroundColor: KIND_COLORS[k.kind] }} />
                ))}
              </View>
              <View style={styles.legend}>
                {kindRows.map((k) => (
                  <View key={k.kind} style={styles.legendItem} testID={`earnings-kind-${k.kind}`}>
                    <View style={[styles.dot, { backgroundColor: KIND_COLORS[k.kind] }]} />
                    <Text style={styles.legendText}>
                      {t(INVESTMENT_KIND_KEYS[k.kind])} {Math.round((k.total / summary.valueUsd) * 100)}%
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
          <Text style={[styles.gain, { color: gainColor }]} testID="earnings-investments-gain">
            {t('invGain')} {gainLabel(summary.gainUsd, summary.gainPct, currency, t)}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
