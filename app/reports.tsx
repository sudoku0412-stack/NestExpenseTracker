import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { addMonths, endOfMonth, format, isSameMonth, startOfMonth } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import Svg, { Circle, G } from 'react-native-svg';
// expo-sharing was added in this branch. The existing preview APK
// doesn't have the native side linked, so a top-level import could
// crash the screen on open. Load it lazily inside the export handler
// instead — only paid for when the user actually taps an export action.
import { Theme, useStyles, useTheme } from '../constants/theme';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { ModalHeader } from '../components/ui/ModalHeader';
import { Button } from '../components/ui/Button';
import { getCustomCategories, resolveCategoryColor, type CustomCategory } from '../lib/customCategories';
import {
  getAllReceipts,
  getAllIncomes,
  getAllInvestmentAccounts,
  getCurrentHouseholdId,
} from '../lib/database';
import { computeStats } from '../lib/dashboardStats';
import { isInCalendarMonth } from '../lib/calendarDate';
import { computeCashflow } from '../lib/cashflowStats';
import { IncomeBreakdownCard } from '../components/ui/IncomeBreakdownCard';
import { InvestmentSnapshotCard } from '../components/ui/InvestmentSnapshotCard';
import type { InvestmentAccount } from '../types';
import { computeBudgetDonut, BudgetDonutModel } from '../lib/budgetDonut';
import { filterReceiptsInRange, receiptsToCsv } from '../lib/reports';
import { generateReceiptsPdf, isPdfExportAvailable } from '../lib/pdfExport';
import { getCategoryBudgets, getCurrency } from '../lib/secureStorage';
import { useEntitlements } from '../lib/EntitlementsContext';
import { CurrencyCode, formatCurrency } from '../lib/currency';
import { CategorySummary, MonthlyStats, Receipt, Category, Income, CashflowStats } from '../types';

import { useT, useLanguage, type TFn } from '../lib/I18nContext';
import { dateFnsLocale, formatMonthYear } from '../lib/dateLocale';
import { getActiveLanguage } from '../lib/i18n';
import { categoryLabel } from '../lib/categoryLabel';
/**
 * Build a human-readable filename for the exported receipt report,
 * e.g. "NestExpenseTracker Expense Report - July 2026.pdf".
 */
function buildExportFilename(month: Date, ext: 'pdf' | 'csv'): string {
  return `NestExpenseTracker Expense Report - ${format(month, 'MMMM yyyy', { locale: dateFnsLocale(getActiveLanguage()) })}.${ext}`;
}

export default function ReportsScreenWrapped() {
  return (
    <ErrorBoundary>
      <ReportsScreen />
    </ErrorBoundary>
  );
}

/**
 * Rendered directly inside the tab bar (reports-tab.tsx) — no ModalHeader
 * back button since it's a tab root, not a pushed screen; native Tabs
 * header supplies the "Reports" title instead, same as the Expenses tab.
 */
export function ReportsScreenEmbedded() {
  return (
    <ErrorBoundary>
      <ReportsScreen embedded />
    </ErrorBoundary>
  );
}

function ReportsScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const t = useT();
  const { language } = useLanguage();
  const theme = useTheme();
  const styles = useReportsStyles();
  const { isPremium } = useEntitlements();
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [budgetTotal, setBudgetTotal] = useState(0);
  const [customs, setCustoms] = useState<CustomCategory[]>([]);
  const [investments, setInvestments] = useState<InvestmentAccount[]>([]);

  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        const hid = getCurrentHouseholdId();
        const [all, allIncomes, code, budgets, customList, accounts] = await Promise.all([
          getAllReceipts(),
          getAllIncomes(),
          getCurrency(),
          hid ? getCategoryBudgets(hid) : Promise.resolve({} as Record<string, number>),
          hid
            ? getCustomCategories(hid).catch(() => [] as CustomCategory[])
            : Promise.resolve([] as CustomCategory[]),
          Promise.resolve()
        .then(() => getAllInvestmentAccounts())
        .catch(() => [] as InvestmentAccount[]),
        ]);
        if (!mounted) return;
        setCustoms(customList);
        setInvestments(accounts);
        setReceipts(all);
        setIncomes(allIncomes);
        if (code) setCurrency(code as CurrencyCode);
        setBudgetTotal(
          Object.values(budgets ?? {}).reduce((s, n) => s + (typeof n === 'number' ? n : 0), 0),
        );
        setLoading(false);
      })();
      return () => {
        mounted = false;
      };
    }, []),
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
        const hid = getCurrentHouseholdId();
        const [all, allIncomes, budgets] = await Promise.all([
          getAllReceipts(),
          getAllIncomes(),
          hid ? getCategoryBudgets(hid) : Promise.resolve({} as Record<string, number>),
        ]);
      setReceipts(all);
      setIncomes(allIncomes);
      setBudgetTotal(
        Object.values(budgets ?? {}).reduce((s, n) => s + (typeof n === 'number' ? n : 0), 0),
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Reports is month-scoped, but browsable — monthOffset=0 is the
  // current calendar month, negative goes back. Can't go past the
  // current month (no future data to show).
  const [monthOffset, setMonthOffset] = useState(0);
  const now = addMonths(new Date(), monthOffset);
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const monthReceipts = filterReceiptsInRange(receipts, monthStart, monthEnd);
  const monthIncomes = incomes.filter((i) =>
    isInCalendarMonth(i.date, now.getFullYear(), now.getMonth() + 1),
  );
  const stats: MonthlyStats = computeStats(monthReceipts);
  const cashflow: CashflowStats = computeCashflow(monthIncomes, monthReceipts);
  const donut = computeBudgetDonut({
    spentByCategory: stats.categories,
    totalSpent: stats.totalSpent,
    budgetTotal,
    earned: cashflow.totalEarned,
  });

  // Separate loading flags per button — a single shared `exporting`
  // flag made tapping either button spin BOTH (each button's `loading`
  // prop was bound to the same boolean).
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Lazy-require expo-sharing — the native side wasn't in the
  // original APK before this branch added it, so a top-level
  // import would crash the screen on older builds.
  const shareFile = useCallback(
    async (path: string, mimeType: string, uti: string, dialogTitle: string) => {
      let Sharing: typeof import('expo-sharing') | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
        Sharing = require('expo-sharing');
      } catch {
        Sharing = null;
      }
      const canShare = Sharing
        ? await Sharing.isAvailableAsync().catch(() => false)
        : false;
      if (Sharing && canShare) {
        await Sharing.shareAsync(path, { mimeType, dialogTitle, UTI: uti });
      } else {
        Alert.alert(
          t('saved'),
          t('sharingUnavailableWithPath', { path }),
        );
      }
    },
    [t],
  );

  const exportCsv = useCallback(async () => {
    if (exportingCsv) return;
    if (monthReceipts.length === 0) {
      Alert.alert(
        t('nothingToExport'),
        t('scanAFewReceiptsBefore'),
      );
      return;
    }
    setExportingCsv(true);
    try {
      const csv = receiptsToCsv(monthReceipts, currency);
      const filename = buildExportFilename(monthStart, 'csv');
      const path = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      await shareFile(
        path,
        'text/csv',
        'public.comma-separated-values-text',
        t('exportExpenseReport'),
      );
    } catch (e) {
      Alert.alert(t('exportFailed'), (e as Error)?.message ?? t('tryAgain'));
    } finally {
      setExportingCsv(false);
    }
  }, [monthReceipts, exportingCsv, monthStart, shareFile, t]);

  const exportPdf = useCallback(async () => {
    if (exportingPdf) return;
    if (monthReceipts.length === 0) {
      Alert.alert(
        t('nothingToExport'),
        t('scanAFewReceiptsBefore'),
      );
      return;
    }
    // PDF export is a Premium feature — CSV export (above) stays free.
    if (!isPremium) {
      router.push('/paywall');
      return;
    }
    // expo-print may not be linked in older/preview APKs — the OTA
    // ships JS only, so we can't assume the native module is loaded
    // until the user installs a fresh build.
    if (!isPdfExportAvailable()) {
      Alert.alert(
        t('pdfUnavailable'),
        t('pdfExportNeedsANewer'),
      );
      return;
    }
    setExportingPdf(true);
    try {
      const startLabel = format(monthStart, 'PP', { locale: dateFnsLocale(language) });
      const endLabel = format(monthEnd, 'PP', { locale: dateFnsLocale(language) });
      const filename = buildExportFilename(monthStart, 'pdf');
      const path = await generateReceiptsPdf({
        receipts: monthReceipts,
        incomes: monthIncomes,
        startLabel,
        endLabel,
        filename,
        currency,
      });
      if (path) {
        await shareFile(path, 'application/pdf', 'com.adobe.pdf', t('exportExpenseReport'));
      }
    } catch (e) {
      Alert.alert(t('exportFailed'), (e as Error)?.message ?? t('tryAgain'));
    } finally {
      setExportingPdf(false);
    }
  }, [monthReceipts, exportingPdf, isPremium, monthStart, monthEnd, shareFile, t]);

  return (
    <SafeAreaView style={styles.root} edges={embedded ? ['bottom'] : ['top', 'bottom']}>
      {!embedded && <ModalHeader title={t('reports')} />}
      <View style={styles.monthNavRow}>
        <Pressable
          onPress={() => setMonthOffset((v) => v - 1)}
          hitSlop={8}
          style={styles.monthNavBtn}
        >
          <Ionicons name="chevron-back" size={20} color={theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.subhead}>{formatMonthYear(now, language)}</Text>
        <Pressable
          onPress={() => setMonthOffset((v) => v + 1)}
          disabled={isSameMonth(now, new Date())}
          hitSlop={8}
          style={styles.monthNavBtn}
        >
          <Ionicons
            name="chevron-forward"
            size={20}
            color={isSameMonth(now, new Date()) ? theme.colors.textMuted : theme.colors.textPrimary}
          />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.content}>
          <Skeleton width={'100%' as `${number}%`} height={140} borderRadius={theme.radius.lg} />
          <Skeleton width={'100%' as `${number}%`} height={170} borderRadius={theme.radius.lg} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent}
            />
          }
        >
          <SummaryCard
            stats={stats}
            cashflow={cashflow}
            donut={donut}
            currency={currency}
            theme={theme}
            customs={customs}
          />

          <IncomeBreakdownCard cashflow={cashflow} currency={currency} />
          {isPremium ? <InvestmentSnapshotCard accounts={investments} currency={currency} /> : null}

          {/* Empty state */}
          {monthReceipts.length === 0 && (
            <EmptyState
              icon="bar-chart-outline"
              title={t('noDataYet')}
              description={t('scanAFewReceiptsAnd')}
            />
          )}

          {/* Export — real CSV/PDF generation via lib/reports + lib/pdfExport,
              shared through expo-sharing. Two equal-width outlined buttons
              per the design spec — the only actions on this screen. */}
          <View style={styles.exportRow}>
            <Button
              label={t('exportCsv')}
              variant="secondary"
              onPress={exportCsv}
              loading={exportingCsv}
              disabled={monthReceipts.length === 0}
              style={styles.exportButton}
            />
            <Button
              label={isPremium ? t('exportPdf') : t('exportPdfPremium')}
              variant="secondary"
              onPress={exportPdf}
              loading={exportingPdf}
              disabled={monthReceipts.length === 0}
              style={styles.exportButton}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function sliceColor(
  key: string,
  remaining: boolean | undefined,
  theme: Theme,
  customs: CustomCategory[],
): string {
  if (remaining) return theme.colors.chartRemaining;
  return resolveCategoryColor(key, theme.colors.category, customs, theme.colors.accent);
}

function donutCaption(donut: BudgetDonutModel, currency: CurrencyCode, t: TFn): string {
  const total = formatCurrency(donut.circleTotal, currency);
  const pot = t(
    donut.source === 'budget'
      ? 'donutPotBudget'
      : donut.source === 'income'
        ? 'donutPotIncome'
        : 'donutPotSpent',
    { total },
  );
  if (donut.remaining > 0.009) {
    return t('donutRemaining', {
      pot,
      pct: donut.remainingPct.toFixed(1),
      amount: formatCurrency(donut.remaining, currency),
    });
  }
  return t('donutFilled', { pot });
}

function SummaryCard({
  stats,
  cashflow,
  donut,
  currency,
  theme,
  customs,
}: {
  stats: MonthlyStats;
  cashflow: CashflowStats;
  donut: BudgetDonutModel;
  currency: CurrencyCode;
  theme: Theme;
  customs: CustomCategory[];
}) {
  const t = useT();
  const styles = useReportsStyles();
  const count = stats.receiptCount;
  return (
    <View style={styles.summaryCard}>
      <View style={styles.donutWrap} accessibilityLabel={t('monthlyBudgetDonut')}>
        <BudgetDonut donut={donut} theme={theme} size={220} customs={customs} />
        <View style={styles.donutCenter} pointerEvents="none">
          {donut.circleTotal > 0 ? (
            <>
              <Text style={styles.donutCenterPct}>
                {donut.remainingPct.toFixed(1)}%
              </Text>
              <Text style={styles.donutCenterSub}>
                {t('leftAmount', { amount: formatCurrency(donut.remaining, currency) })}
              </Text>
            </>
          ) : (
            <Text style={styles.donutCenterSub}>{t('noPotYet')}</Text>
          )}
        </View>
      </View>
      <View style={styles.legendGrid}>
        {donut.slices.map((slice) => (
          <View key={slice.key} style={styles.legendCell}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: sliceColor(slice.key, slice.remaining, theme, customs) },
                slice.remaining ? styles.legendDotRemaining : null,
              ]}
            />
            <Text style={styles.legendLabel} numberOfLines={1}>
              {slice.remaining ? t('remainingUnspent') : categoryLabel(slice.key)}
            </Text>
            <Text style={styles.legendPct}>{slice.percentage.toFixed(1)}%</Text>
          </View>
        ))}
      </View>
      {donut.circleTotal > 0 ? (
        <Text style={styles.donutCaption}>{donutCaption(donut, currency, t)}</Text>
      ) : (
        <Text style={styles.donutCaption}>
          {t('addIncomeOrCategoryBudgets')}
        </Text>
      )}
      <Text style={styles.summarySub}>
        {t('totalAcrossExpenses', { amount: formatCurrency(stats.totalSpent, currency), count })}
      </Text>
      <View style={styles.cashflowRow}>
        <View style={styles.cashflowCell}>
          <Text style={styles.cashflowLabel}>{t('earned')}</Text>
          <Text style={[styles.cashflowValue, { color: theme.colors.success }]}>
            {formatCurrency(cashflow.totalEarned, currency)}
          </Text>
        </View>
        <View style={styles.cashflowCell}>
          <Text style={styles.cashflowLabel}>{t('spent')}</Text>
          <Text style={styles.cashflowValue}>
            {formatCurrency(cashflow.totalSpent, currency)}
          </Text>
        </View>
        <View style={styles.cashflowCell}>
          <Text style={styles.cashflowLabel}>{t('net')}</Text>
          <Text
            style={[
              styles.cashflowValue,
              { color: cashflow.net >= 0 ? theme.colors.success : theme.colors.error },
            ]}
          >
            {formatCurrency(cashflow.net, currency)}
          </Text>
        </View>
      </View>
      {cashflow.investedUsd > 0 ? (
        <View style={styles.cashflowRow}>
          <View style={styles.cashflowCell}>
            <Text style={styles.cashflowLabel}>{t('invested')}</Text>
            <Text style={styles.cashflowValue}>
              {formatCurrency(cashflow.investedUsd, currency)}
            </Text>
          </View>
          <View style={styles.cashflowCell}>
            <Text style={styles.cashflowLabel}>{t('consumed')}</Text>
            <Text style={styles.cashflowValue}>
              {formatCurrency(cashflow.consumedUsd, currency)}
            </Text>
          </View>
          <View style={styles.cashflowCell}>
            <Text style={styles.cashflowLabel}>{t('saved')}</Text>
            <Text style={[styles.cashflowValue, { color: theme.colors.success }]}>
              {cashflow.savingsRate != null
                ? `${(cashflow.savingsRate * 100).toFixed(0)}%`
                : '—'}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One ring = one pot. Colored arcs are spend. Remaining shows through as
 * a dashed gray track behind the spent wedges (screenshot: leftover slice).
 */
function BudgetDonut({
  donut,
  theme,
  size = 220,
  customs,
}: {
  donut: BudgetDonutModel;
  theme: Theme;
  size?: number;
  customs: CustomCategory[];
}) {
  const strokeWidth = Math.round(size * 0.22);
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const center = size / 2;
  const spentSlices = donut.slices.filter((s) => !s.remaining && s.amount > 0);

  if (donut.circleTotal <= 0) {
    return (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={theme.colors.chartRemaining}
          strokeWidth={strokeWidth}
          strokeDasharray="6 8"
          fill="none"
        />
      </Svg>
    );
  }

  let offset = 0;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle
        cx={center}
        cy={center}
        r={r}
        stroke={theme.colors.chartRemaining}
        strokeWidth={strokeWidth}
        strokeDasharray="5 7"
        fill="none"
      />
      <G rotation={-90} origin={`${center}, ${center}`}>
        {spentSlices.map((slice) => {
          const frac = slice.amount / donut.circleTotal;
          const dash = Math.max(0, frac * circumference);
          const dashOffset = -offset;
          offset += dash;
          return (
            <Circle
              key={slice.key}
              cx={center}
              cy={center}
              r={r}
              stroke={sliceColor(slice.key, false, theme, customs)}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="butt"
              fill="none"
            />
          );
        })}
      </G>
    </Svg>
  );
}

function useReportsStyles() {
  return useStyles((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  subhead: {
    color: theme.colors.textMuted,
    fontSize: theme.font.sm,
    fontFamily: theme.fonts.body.regular,
    textAlign: 'center',
    paddingTop: theme.spacing.xs,
  },
  monthNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  monthNavBtn: {
    padding: theme.spacing.xs,
  },
  content: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    paddingBottom: 100,
  },
  summaryCard: {
    backgroundColor: theme.colors.cardTint.sky,
    borderRadius: 20,
    padding: theme.spacing.lg,
    alignItems: 'stretch',
    gap: theme.spacing.sm,
    borderWidth: theme.isDark ? 0 : 1,
    borderColor: theme.colors.border,
    shadowColor: theme.isDark ? '#000' : '#0C0F24',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: theme.isDark ? 0.4 : 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  donutWrap: {
    alignSelf: 'center',
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: theme.spacing.sm,
  },
  donutCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  donutCenterPct: {
    color: theme.colors.textPrimary,
    fontSize: 32,
    fontFamily: theme.fonts.display.bold,
    textAlign: 'center',
  },
  donutCenterSub: {
    color: theme.colors.textMuted,
    fontSize: theme.font.sm,
    fontFamily: theme.fonts.body.regular,
    textAlign: 'center',
    marginTop: 2,
  },
  legendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: theme.spacing.md,
    rowGap: theme.spacing.xs,
  },
  legendCell: {
    width: '46%' as `${number}%`,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: theme.radius.full,
  },
  legendDotRemaining: {
    borderWidth: 1,
    borderColor: theme.colors.chartRemaining,
    backgroundColor: theme.colors.chartRemaining,
    borderStyle: 'dashed',
  },
  legendLabel: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: theme.font.sm,
    fontFamily: theme.fonts.body.regular,
  },
  legendPct: {
    color: theme.colors.textMuted,
    fontSize: theme.font.xs,
    fontFamily: theme.fonts.mono.regular,
  },
  donutCaption: {
    color: theme.colors.textPrimary,
    fontSize: theme.font.sm,
    fontFamily: theme.fonts.body.regular,
    lineHeight: 20,
    marginTop: theme.spacing.xs,
  },
  summarySub: {
    color: theme.colors.textMuted,
    fontSize: theme.font.sm,
    fontFamily: theme.fonts.body.regular,
  },
  cashflowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  cashflowCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  cashflowLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.font.xs,
    fontFamily: theme.fonts.body.regular,
    textTransform: 'uppercase',
  },
  cashflowValue: {
    color: theme.colors.textPrimary,
    fontSize: theme.font.sm,
    fontFamily: theme.fonts.mono.medium,
  },
  section: {
    gap: theme.spacing.sm,
  },
  sectionTitle: {
    color: theme.colors.textPrimary,
    fontSize: theme.font.md,
    fontFamily: theme.fonts.display.bold,
  },
  sectionBody: {
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    padding: theme.spacing.sm,
    gap: theme.spacing.xs,
    shadowColor: theme.isDark ? '#000' : '#0C0F24',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: theme.isDark ? 0.4 : 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  categoryDot: {
    width: 10,
    height: 10,
    borderRadius: theme.radius.full,
  },
  rowLabel: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: theme.font.sm,
    fontFamily: theme.fonts.body.regular,
  },
  rowPct: {
    color: theme.colors.textMuted,
    fontSize: theme.font.xs,
    fontFamily: theme.fonts.mono.regular,
    minWidth: 34,
    textAlign: 'right',
  },
  rowAmount: {
    color: theme.colors.textPrimary,
    fontSize: theme.font.sm,
    fontFamily: theme.fonts.mono.medium,
    minWidth: 72,
    textAlign: 'right',
  },
  exportRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  exportButton: {
    flex: 1,
    height: 44,
    borderRadius: 16,
  },
  }));
}
