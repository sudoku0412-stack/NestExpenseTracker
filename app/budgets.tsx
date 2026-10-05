import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModalHeader } from '../components/ui/ModalHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { useStyles, useTheme } from '../constants/theme';
import { categoryIcon } from '../constants/categories';
import { getReceiptsByMonth, getCurrentHouseholdId } from '../lib/database';
import { getCategoryBudgets, getCurrency } from '../lib/secureStorage';
import { computeBudgetSpend } from '../lib/budgetSpend';
import { computeBudgetOverview, type BudgetOverview, type BudgetStatus } from '../lib/budgetOverview';
import { CurrencyCode, formatCurrency } from '../lib/currency';
import { getCustomCategories, resolveCategoryColor, type CustomCategory } from '../lib/customCategories';
import { RECURRING_BUDGET_KEY } from '../lib/recurring';
import { categoryLabel } from '../lib/categoryLabel';
import { formatMonthYear } from '../lib/dateLocale';
import { useLanguage, useT } from '../lib/I18nContext';

const EMPTY: BudgetOverview = {
  lines: [],
  totalBudget: 0,
  totalSpent: 0,
  leftOfTotal: 0,
  leftAcrossBudgets: 0,
};

/** Budget overview: every category with a budget, how much of it is spent
 *  and left, plus the total left of the whole budget and the room left
 *  across all budgets. Reached from Home's Budgets section; Manage jumps to
 *  that category's row in Settings. */
export default function BudgetsScreen() {
  const t = useT();
  const { language } = useLanguage();
  const theme = useTheme();
  const router = useRouter();
  const { year: yearParam, month: monthParam } = useLocalSearchParams<{ year?: string; month?: string }>();
  const styles = useBudgetsStyles();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<BudgetOverview>(EMPTY);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [customs, setCustoms] = useState<CustomCategory[]>([]);

  const now = new Date();
  const year = Number(yearParam) || now.getFullYear();
  const month = Number(monthParam) || now.getMonth() + 1;

  const load = useCallback(async () => {
    const hid = getCurrentHouseholdId();
    const [receipts, budgets, code, customList] = await Promise.all([
      getReceiptsByMonth(year, month),
      hid ? getCategoryBudgets(hid) : Promise.resolve({} as Record<string, number>),
      getCurrency(),
      hid ? getCustomCategories(hid).catch(() => [] as CustomCategory[]) : Promise.resolve([] as CustomCategory[]),
    ]);
    setOverview(computeBudgetOverview(budgets ?? {}, computeBudgetSpend(receipts)));
    if (code) setCurrency(code as CurrencyCode);
    setCustoms(customList);
    setLoading(false);
  }, [year, month]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => setLoading(false));
    }, [load]),
  );

  const manage = (category?: string) =>
    router.push({
      pathname: '/settings',
      params: { section: 'budgets', ...(category ? { category } : {}) },
    } as never);

  const statusMeta: Record<BudgetStatus, { label: string; color: string; bg: string }> = {
    onTrack: { label: t('onTrack'), color: theme.colors.success, bg: theme.colors.successFaint },
    watch: { label: t('watch'), color: theme.colors.accent, bg: theme.colors.accentTint },
    over: { label: t('over'), color: theme.colors.error, bg: theme.colors.errorFaint },
  };

  const colorFor = (category: string) =>
    category === RECURRING_BUDGET_KEY
      ? theme.colors.accent
      : resolveCategoryColor(category, theme.colors.category, customs, theme.colors.accent);

  const monthLabel = formatMonthYear(new Date(year, month - 1, 1), language);
  const overTotal = overview.leftOfTotal < 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ModalHeader title={t('budgets')} onBack={() => router.back()} />
      {!loading && overview.lines.length === 0 ? (
        <EmptyState
          icon="speedometer-outline"
          title={t('noBudgetsYet')}
          description={t('noBudgetsYetBody')}
          actionLabel={t('setBudgets')}
          onAction={() => manage()}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.summary} testID="budgets-summary">
            <Text style={styles.month}>{monthLabel}</Text>
            <View style={styles.summaryRow}>
              <View style={styles.summaryBlock}>
                <Text style={[styles.summaryValue, overTotal ? { color: theme.colors.error } : null]} testID="budgets-left-total">
                  {formatCurrency(Math.abs(overview.leftOfTotal), currency)}
                </Text>
                <Text style={styles.summaryLabel}>{overTotal ? t('overTotalBudget') : t('leftOfTotalBudget')}</Text>
              </View>
              <View style={styles.summaryBlock}>
                <Text style={styles.summaryValue} testID="budgets-left-across">
                  {formatCurrency(overview.leftAcrossBudgets, currency)}
                </Text>
                <Text style={styles.summaryLabel}>{t('leftAcrossBudgets')}</Text>
              </View>
            </View>
            <Text style={styles.summaryNote}>
              {t('amountOfAmount', {
                a: formatCurrency(overview.totalSpent, currency),
                b: formatCurrency(overview.totalBudget, currency),
              })}
            </Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${overview.totalBudget > 0 ? Math.min(overview.totalSpent / overview.totalBudget, 1) * 100 : 0}%`,
                    backgroundColor: overTotal ? theme.colors.error : theme.colors.accent,
                  },
                ]}
              />
            </View>
          </View>

          {overview.lines.map((b) => {
            const meta = statusMeta[b.status];
            const color = colorFor(b.category);
            return (
              <View key={b.category} style={styles.card} testID={`budget-row-${b.category}`}>
                <View style={styles.cardHead}>
                  <View style={[styles.avatar, { backgroundColor: `${color}26` }]}>
                    <Text style={styles.avatarText}>{categoryIcon(b.category, '🏷️')}</Text>
                  </View>
                  <Text style={styles.name} numberOfLines={1}>
                    {categoryLabel(b.category)}
                  </Text>
                  <View style={[styles.pill, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.pillText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${b.ratio * 100}%`, backgroundColor: b.ratio > 0.9 ? theme.colors.error : color },
                    ]}
                    testID={`budget-bar-${b.category}`}
                  />
                </View>
                <View style={styles.cardFoot}>
                  <View>
                    <Text style={styles.amounts}>
                      {t('amountOfAmount', {
                        a: formatCurrency(b.spent, currency),
                        b: formatCurrency(b.limit, currency),
                      })}
                    </Text>
                    <Text
                      style={[styles.left, { color: meta.color }]}
                      testID={`budget-left-${b.category}`}
                    >
                      {b.left < 0
                        ? t('overByAmount', { amount: formatCurrency(-b.left, currency) })
                        : t('leftAmountShort', { amount: formatCurrency(b.left, currency) })}
                    </Text>
                  </View>
                  <TouchableOpacity
                    testID={`budget-manage-${b.category}`}
                    onPress={() => manage(b.category)}
                    accessibilityRole="button"
                    style={styles.manageBtn}
                    hitSlop={6}
                  >
                    <Text style={styles.manageText}>{t('manage')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          <TouchableOpacity testID="budgets-manage-all" onPress={() => manage()} style={styles.manageAll} accessibilityRole="button">
            <Text style={styles.manageText}>{t('editAllBudgets')}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function useBudgetsStyles() {
  return useStyles((th) => ({
    screen: { flex: 1, backgroundColor: th.colors.background },
    scroll: { padding: th.spacing.md, gap: th.spacing.sm, paddingBottom: 48 },
    summary: {
      backgroundColor: th.colors.surface,
      borderRadius: 18,
      padding: th.spacing.md,
      gap: 8,
      borderWidth: th.isDark ? 0 : 1,
      borderColor: th.colors.border,
    },
    month: { color: th.colors.textMuted, fontFamily: th.fonts.body.regular, fontSize: th.font.xs },
    summaryRow: { flexDirection: 'row' as const, gap: 12, marginBottom: 6 },
    summaryBlock: { flex: 1, gap: 2 },
    summaryValue: { color: th.colors.textPrimary, fontFamily: th.fonts.mono.medium, fontSize: th.font.lg, lineHeight: 32 },
    summaryLabel: { color: th.colors.textMuted, fontFamily: th.fonts.body.regular, fontSize: th.font.xs, lineHeight: 16 },
    summaryNote: { color: th.colors.textSecondary, fontFamily: th.fonts.body.regular, fontSize: th.font.xs },
    track: { height: 8, borderRadius: th.radius.full, backgroundColor: th.colors.surfaceHigh, overflow: 'hidden' as const },
    fill: { height: '100%' as const, borderRadius: th.radius.full },
    card: {
      backgroundColor: th.colors.surface,
      borderRadius: 18,
      padding: th.spacing.md,
      gap: 10,
      borderWidth: th.isDark ? 0 : 1,
      borderColor: th.colors.border,
    },
    cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
    avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center' as const, justifyContent: 'center' as const },
    avatarText: { fontSize: 16 },
    name: { flex: 1, color: th.colors.textPrimary, fontFamily: th.fonts.display.bold, fontSize: th.font.md },
    pill: { borderRadius: th.radius.full, paddingHorizontal: 10, paddingVertical: 3 },
    pillText: { fontFamily: th.fonts.display.bold, fontSize: th.font.xs },
    cardFoot: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, justifyContent: 'space-between' as const },
    amounts: { color: th.colors.textSecondary, fontFamily: th.fonts.mono.medium, fontSize: th.font.xs },
    left: { color: th.colors.textPrimary, fontFamily: th.fonts.mono.medium, fontSize: th.font.sm, marginTop: 2 },
    manageBtn: {
      borderWidth: 1,
      borderColor: th.colors.border,
      borderRadius: th.radius.full,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    manageText: { color: th.colors.accent, fontFamily: th.fonts.display.bold, fontSize: th.font.sm },
    manageAll: { alignItems: 'center' as const, paddingVertical: 12 },
  }));
}
