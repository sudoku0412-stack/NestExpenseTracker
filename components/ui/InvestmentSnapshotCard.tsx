import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Theme, useStyles, useTheme } from '../../constants/theme';
import { formatCurrency, type CurrencyCode } from '../../lib/currency';
import { useT } from '../../lib/I18nContext';
import { gainLabel, summarizeInvestments } from '../../lib/investments';
import type { InvestmentAccount } from '../../types';

const makeStyles = (t: Theme) => ({
  card: {
    backgroundColor: t.colors.cardTint.sky,
    borderRadius: 18,
    padding: t.spacing.md,
    borderWidth: t.isDark ? 0 : 1,
    borderColor: t.colors.border,
    gap: 8,
  },
  title: {
    fontFamily: t.fonts.display.bold,
    fontSize: t.font.sm,
    color: t.colors.textPrimary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  row: { flexDirection: 'row' as const, gap: 12 },
  block: { flex: 1, gap: 2 },
  value: { fontFamily: t.fonts.mono.medium, fontSize: t.font.lg, color: t.colors.textPrimary },
  label: { fontFamily: t.fonts.body.regular, fontSize: t.font.xs, color: t.colors.textMuted },
});

/** Portfolio at a glance: total value, contributed, gain. Tap opens the
 *  investments screen. Renders nothing when there are no accounts. */
export function InvestmentSnapshotCard({
  accounts,
  currency,
  onPress,
}: {
  accounts: InvestmentAccount[];
  currency: CurrencyCode;
  onPress?: () => void;
}) {
  const t = useT();
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  if (accounts.length === 0) return null;
  const s = summarizeInvestments(accounts);
  const gainColor = s.gainUsd > 0 ? theme.colors.success : s.gainUsd < 0 ? theme.colors.error : theme.colors.textPrimary;
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      testID="investment-snapshot"
    >
      <Text style={styles.title}>{t('investmentsTitle')}</Text>
      <View style={styles.row}>
        <View style={styles.block}>
          <Text style={styles.value}>{formatCurrency(s.valueUsd, currency)}</Text>
          <Text style={styles.label}>{t('invTotalValue')}</Text>
        </View>
        <View style={styles.block}>
          <Text style={styles.value}>{formatCurrency(s.contributedUsd, currency)}</Text>
          <Text style={styles.label}>{t('invContributed')}</Text>
        </View>
        <View style={styles.block}>
          <Text style={[styles.value, { color: gainColor }]} testID="investment-snapshot-gain">
            {gainLabel(s.gainUsd, s.gainPct, currency, t)}
          </Text>
          <Text style={styles.label}>{t('invGain')}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}
