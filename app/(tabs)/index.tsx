import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { addMonths, format, isSameMonth, isToday, isYesterday, subMonths } from 'date-fns';
import {
  getAllSavingsGoals,
  getCurrentHouseholdId,
  getIncomesByMonth,
  getReceiptsByMonth,
  getReviewQueueCount,
  getAllInvestmentAccounts,
} from '../../lib/database';
import { getCategoryBudgets, getCurrency } from '../../lib/secureStorage';
import { checkBudgetsAndNotify } from '../../lib/notifications';
import {
  getCustomCategories,
  resolveCategoryColor,
  type CustomCategory,
} from '../../lib/customCategories';
import { formatCurrency, CurrencyCode } from '../../lib/currency';
import { CashflowStats, Receipt, MonthlyStats, SavingsGoal } from '../../types';
import { useStyles, useTheme } from '../../constants/theme';
import { EmptyState } from '../../components/ui/EmptyState';
import { computeStats } from '../../lib/dashboardStats';
import { computeCashflow } from '../../lib/cashflowStats';
import { EarningsInvestmentsCard } from '../../components/ui/EarningsInvestmentsCard';
import type { InvestmentAccount } from '../../types';
import { RECURRING_BUDGET_KEY } from '../../lib/recurring';
import { computeBudgetSpend } from '../../lib/budgetSpend';
import { useAuth } from '../../lib/AuthContext';
import { useEntitlements } from '../../lib/EntitlementsContext';
import type { Profile } from '../../lib/profile';
import { onLocalDataChanged } from '../../lib/dataSync';
import { getHouseholdMembers, HouseholdMember } from '../../lib/cloudSync';
import { categoryIcon, ALL_CATEGORIES } from '../../constants/categories';

import { useT, useLanguage, type TFn } from '../../lib/I18nContext';
import { categoryLabel } from '../../lib/categoryLabel';
import { formatMonthYear, relativeDayLabel } from '../../lib/dateLocale';
import type { Language } from '../../lib/i18n';
/**
 * Single-arc radial progress ring, reusing the same react-native-svg
 * stroke-dasharray technique as reports.tsx's CategoryDonut (this repo's
 * one existing SVG-ring pattern) rather than introducing a second charting
 * approach. Unlike the donut (which draws one arc per category), this
 * draws a single progress arc against a track circle — used for both the
 * hero "pace" ring and the per-budget ring chips.
 *
 * `pct` is clamped to [0, 1] so a ratio over 100% still renders as a full
 * ring instead of overflowing/wrapping.
 */
function RingProgress({
  size,
  strokeWidth,
  pct,
  color,
  trackColor,
  testID,
}: {
  size: number;
  strokeWidth: number;
  pct: number;
  color: string;
  trackColor: string;
  testID?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const center = size / 2;
  const clamped = Math.max(0, Math.min(pct, 1));
  const dash = clamped * circumference;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} testID={testID}>
      <Circle cx={center} cy={center} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
      {clamped > 0 && (
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          fill="none"
          rotation={-90}
          origin={`${center}, ${center}`}
        />
      )}
    </Svg>
  );
}

function greeting(firstName: string | null, t: TFn): string {
  const h = new Date().getHours();
  const base = h < 12 ? t('goodMorning') : h < 18 ? t('goodAfternoon') : t('goodEvening');
  return firstName ? `${base}, ${firstName}` : base;
}

// Firebase Auth's displayName is already auto-populated from Google/Apple
// sign-in (see lib/auth.ts) and backfilled for email/password accounts
// from the local profile (see AuthContext.tsx) — this just picks whichever
// is available and takes the first token, since the greeting has no room
// for a full name.
function firstNameOf(displayName: string | null | undefined, profile: Profile | null): string | null {
  const full = displayName?.trim() || (profile ? `${profile.firstName} ${profile.lastName}`.trim() : '');
  return full ? full.split(/\s+/)[0] : null;
}

function dateLabel(date: Date, language: Language): string {
  return relativeDayLabel(date, language);
}

type BudgetStatus = 'onTrack' | 'watch' | 'over';

// Exact thresholds from the design spec: ≤70% = on track, 70-90% =
// watch, >90% = over (the progress bar itself also turns error-red
// past 90%, independent of the status-chip color).
function budgetStatus(spent: number, limit: number): BudgetStatus {
  const ratio = limit > 0 ? spent / limit : 0;
  if (ratio > 0.9) return 'over';
  if (ratio > 0.7) return 'watch';
  return 'onTrack';
}

export default function DashboardScreen() {
  const t = useT();
  const { language } = useLanguage();
  const theme = useTheme();
  const { memberships, user, profile } = useAuth();
  const { isPremium } = useEntitlements();
  const styles = useStyles((t) => ({
    screen: { flex: 1, backgroundColor: t.colors.background },
    content: {
      paddingHorizontal: 20,
      paddingTop: t.spacing.lg,
      paddingBottom: 100,
      gap: t.spacing.lg,
    },
    householdRow: {
      flexDirection: 'row',
    },
    householdChip: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: t.colors.accent,
      borderRadius: t.radius.full,
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 8,
      maxWidth: '90%',
      shadowColor: t.colors.accent,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.35,
      shadowRadius: 6,
      elevation: 4,
    },
    householdRowName: {
      flexShrink: 1,
      color: '#fff',
      fontSize: t.font.md,
      fontFamily: t.fonts.display.bold,
    },

    reviewBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: t.colors.surface,
      borderRadius: 16,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    reviewBannerText: {
      flex: 1,
      color: t.colors.textPrimary,
      fontSize: t.font.sm,
      fontFamily: t.fonts.display.bold,
    },

    heroCard: {
      borderRadius: 24,
      paddingHorizontal: 22,
      paddingVertical: 20,
      backgroundColor: t.colors.primary,
      overflow: 'hidden',
      position: 'relative',
      shadowColor: '#0C0F24',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.25,
      shadowRadius: 14,
      elevation: 4,
    },
    heroDecorCircle: {
      position: 'absolute',
      top: -40,
      right: -40,
      width: 140,
      height: 140,
      borderRadius: t.radius.full,
      backgroundColor: 'rgba(255,255,255,0.08)',
    },
    heroDecorWatermark: {
      position: 'absolute',
      bottom: -18,
      right: -10,
      opacity: 0.08,
    },
    heroLabel: {
      color: 'rgba(255,255,255,0.6)',
      fontFamily: t.fonts.display.bold,
      fontSize: 11,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    heroAmount: {
      color: '#fff',
      fontFamily: t.fonts.mono.medium,
      fontSize: 38,
      marginTop: 4,
    },
    heroAmountShrinkWrap: {
      flexShrink: 1,
      minWidth: 0,
    },
    heroAmountRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: t.spacing.sm,
    },
    paceRingWrap: {
      alignItems: 'center',
      flexShrink: 0,
    },
    paceRingCircleWrap: {
      width: 46,
      height: 46,
      alignItems: 'center',
      justifyContent: 'center',
    },
    paceRingPctText: {
      position: 'absolute',
      color: '#fff',
      fontFamily: t.fonts.display.bold,
      fontSize: 12,
    },
    paceRingCap: {
      color: 'rgba(255,255,255,0.55)',
      fontFamily: t.fonts.display.bold,
      fontSize: 8,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      marginTop: 3,
    },
    heroMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      marginTop: t.spacing.sm,
    },
    heroMetaText: {
      color: 'rgba(255,255,255,0.6)',
      fontFamily: t.fonts.body.regular,
      fontSize: 12,
    },
    cashflowStrip: {
      marginTop: t.spacing.sm,
      paddingTop: t.spacing.sm,
      borderTopWidth: 1,
      borderTopColor: 'rgba(255,255,255,0.12)',
      gap: 8,
    },
    cashflowBarRow: {
      gap: 6,
    },
    cashflowBarHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    cashflowBarLabel: {
      color: 'rgba(255,255,255,0.7)',
      fontFamily: t.fonts.display.bold,
      fontSize: 11,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    cashflowBarValue: {
      color: '#fff',
      fontFamily: t.fonts.mono.medium,
      fontSize: 13,
    },
    cashflowTrack: {
      height: 8,
      borderRadius: 999,
      backgroundColor: 'rgba(255,255,255,0.12)',
      overflow: 'hidden',
    },
    cashflowFill: {
      height: '100%',
      borderRadius: 999,
    },
    cashflowNetPositive: {
      color: '#9FE0C8',
      fontFamily: t.fonts.mono.medium,
      fontSize: 13,
    },
    cashflowNetNegative: {
      color: '#F0B4B6',
      fontFamily: t.fonts.mono.medium,
      fontSize: 13,
    },
    cashflowMembers: {
      gap: 8,
      marginTop: 4,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: 'rgba(255,255,255,0.1)',
    },
    cashflowMemberRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: 12,
    },
    cashflowMemberName: {
      flex: 1,
      color: 'rgba(255,255,255,0.72)',
      fontFamily: t.fonts.body.medium,
      fontSize: 12,
    },
    cashflowMemberAmt: {
      color: '#fff',
      fontFamily: t.fonts.mono.medium,
      fontSize: 12,
    },
    cashflowInvested: {
      color: 'rgba(255,255,255,0.55)',
      fontFamily: t.fonts.body.regular,
      fontSize: 11,
    },
    trendPill: {
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: t.radius.full,
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    trendPillText: { fontFamily: t.fonts.display.bold, fontSize: 10 },
    monthNavRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.xs,
      marginTop: 4,
    },
    monthNavBtn: {
      padding: 4,
    },
    monthNavLabel: {
      color: 'rgba(255,255,255,0.85)',
      fontFamily: t.fonts.display.bold,
      fontSize: 13,
    },

    compositionCard: {
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
    },
    compositionHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: 9,
    },
    compNote: {
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.xs,
      color: t.colors.textMuted,
    },
    compBar: {
      flexDirection: 'row',
      height: 8,
      borderRadius: t.radius.full,
      overflow: 'hidden',
      gap: 1.5,
    },
    compSegment: {
      height: '100%',
    },
    compLegend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      marginTop: 9,
    },
    compLegendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    compDot: {
      width: 7,
      height: 7,
      borderRadius: t.radius.full,
    },
    compLegendText: {
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.xs,
      color: t.colors.textSecondary,
    },

    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: t.spacing.sm,
    },
    actionBtn: {
      flexGrow: 1,
      flexBasis: '40%',
      minWidth: 140,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 14,
      borderRadius: 16,
      backgroundColor: t.colors.surfaceCard,
      borderWidth: t.isDark ? 0 : 1,
      borderColor: t.colors.border,
      shadowColor: t.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: t.isDark ? 0.35 : 0.06,
      shadowRadius: 8,
      elevation: 1,
    },
    actionBtnText: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.body.medium,
      fontSize: t.font.xs,
      textAlign: 'center' as const,
    },

    section: { gap: t.spacing.sm },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sectionTitle: {
      color: t.colors.textMuted,
      fontFamily: t.fonts.display.bold,
      fontSize: 12,
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    sectionLink: {
      color: t.colors.accent,
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.sm,
    },

    budgetScrollContent: {
      flexDirection: 'row',
      gap: t.spacing.sm,
    },
    budgetChip: {
      backgroundColor: t.colors.cardTint.lavender,
      borderRadius: 18,
      padding: 12,
      width: 112,
      borderWidth: t.isDark ? 0 : 1,
      borderColor: t.colors.border,
      shadowColor: t.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: t.isDark ? 0.4 : 0.08,
      shadowRadius: 10,
      elevation: 2,
    },
    budgetChipTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    budgetChipStatusPill: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: t.radius.full,
    },
    budgetChipStatusText: {
      fontFamily: t.fonts.display.bold,
      fontSize: 9,
    },
    budgetChipName: {
      color: t.colors.textPrimary,
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.sm,
      marginTop: 9,
      marginBottom: 2,
    },
    budgetChipAmt: {
      color: t.colors.textMuted,
      fontFamily: t.fonts.mono.regular,
      fontSize: 10,
    },

    list: { gap: t.spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.colors.cardTint.peach,
      borderRadius: 20,
      padding: t.spacing.md,
      justifyContent: 'space-between',
      borderWidth: t.isDark ? 0 : 1,
      borderColor: t.colors.border,
      shadowColor: t.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: t.isDark ? 0.4 : 0.08,
      shadowRadius: 10,
      elevation: 2,
    },
    savingsCard: {
      backgroundColor: t.colors.cardTint.mint,
      borderRadius: 18,
      padding: t.spacing.md,
      borderWidth: t.isDark ? 0 : 1,
      borderColor: t.colors.border,
      shadowColor: t.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: t.isDark ? 0.4 : 0.08,
      shadowRadius: 10,
      elevation: 2,
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.spacing.sm,
      flex: 1,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    avatarText: {
      fontSize: 20,
    },
    rowInfo: { flex: 1, gap: 2 },
    merchantName: {
      fontFamily: t.fonts.display.bold,
      fontSize: t.font.md,
      color: t.colors.textPrimary,
    },
    rowMeta: {
      fontFamily: t.fonts.body.regular,
      fontSize: t.font.xs,
      color: t.colors.textMuted,
    },
    rowAmount: {
      fontFamily: t.fonts.mono.medium,
      fontSize: t.font.md,
      color: t.colors.textPrimary,
      paddingLeft: t.spacing.sm,
    },
    goalTrack: {
      height: 8,
      borderRadius: 999,
      backgroundColor: t.colors.surfaceHigh,
      overflow: 'hidden' as const,
      marginTop: 8,
    },
    goalFill: {
      height: '100%' as const,
      borderRadius: 999,
      backgroundColor: t.colors.success,
    },
  }));

  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [stats, setStats] = useState<MonthlyStats>({
    totalSpent: 0,
    receiptCount: 0,
    topCategory: null,
    avgPerReceipt: 0,
    categories: [],
  });
  const [cashflow, setCashflow] = useState<CashflowStats>({
    totalEarned: 0,
    totalSpent: 0,
    net: 0,
    incomeCount: 0,
    investedUsd: 0,
    consumedUsd: 0,
    savingsRate: null,
    byMember: [],
    byCategory: [],
  });
  const [investments, setInvestments] = useState<InvestmentAccount[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [lastMonthTotal, setLastMonthTotal] = useState<number | null>(null);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  // 0 = current calendar month, negative = further back. Lets the
  // dashboard browse older months instead of only ever showing "now".
  const [monthOffset, setMonthOffset] = useState(0);
  const viewedMonth = addMonths(new Date(), monthOffset);
  const isCurrentMonth = isSameMonth(viewedMonth, new Date());

  const load = useCallback(async () => {
    const prevMonth = subMonths(viewedMonth, 1);
    const householdId = getCurrentHouseholdId();
    const year = viewedMonth.getFullYear();
    const month = viewedMonth.getMonth() + 1;
    const [data, incomes, prevData, budgetMap, currencyCode, memberList, goals, toReview, customs, accounts] = await Promise.all([
      getReceiptsByMonth(year, month),
      getIncomesByMonth(year, month),
      getReceiptsByMonth(prevMonth.getFullYear(), prevMonth.getMonth() + 1),
      householdId ? getCategoryBudgets(householdId) : Promise.resolve({}),
      getCurrency(),
      householdId && user?.uid
        ? getHouseholdMembers({ householdId, currentUid: user.uid })
        : Promise.resolve(null),
      getAllSavingsGoals().catch(() => []),
      Promise.resolve()
        .then(() => getReviewQueueCount())
        .catch(() => 0),
      householdId
        ? getCustomCategories(householdId).catch(() => [] as CustomCategory[])
        : Promise.resolve([] as CustomCategory[]),
      Promise.resolve()
        .then(() => getAllInvestmentAccounts())
        .catch(() => [] as InvestmentAccount[]),
    ]);
    setReceipts(data);
    setInvestments(accounts);
    setStats(computeStats(data));
    setCashflow(computeCashflow(incomes, data));
    setLastMonthTotal(prevData.reduce((s, r) => s + r.totalAmount, 0));
    setBudgets(budgetMap);
    setCurrency((currencyCode as CurrencyCode | null) ?? 'USD');
    setMembers(memberList ?? []);
    setSavingsGoals(goals);
    setReviewCount(toReview);
    setCustomCategories(customs);
  }, [monthOffset, user?.uid]);

  useFocusEffect(
    useCallback(() => {
      load();
      // Fire-and-forget: checkBudgetsAndNotify handles its own toggle +
      // OS-permission gating and once/day throttling, so this call site
      // just needs to trigger it without blocking the data load above.
      checkBudgetsAndNotify().catch(() => {});
    }, [load]),
  );

  // useFocusEffect only fires on navigation focus changes — if Home was
  // already the focused screen when the app got backgrounded (e.g. a
  // shared-expense/settle-up push was tapped while Home was already
  // open), resuming the app is an AppState change with no navigation
  // event, so the load above would otherwise never refire and the
  // screen would show stale data despite "opening."
  const appState = useRef(AppState.currentState);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appState.current !== 'active' && nextState === 'active') {
        load();
        checkBudgetsAndNotify().catch(() => {});
      }
      appState.current = nextState;
    });
    return () => subscription.remove();
  }, [load]);

  // Firestore listeners (cloudSync.ts) write cloud changes into local
  // SQLite/SecureStore asynchronously, on their own schedule — often
  // AFTER the AppState/focus reload above already ran (e.g. resuming
  // from a notification tap races the listener reconnecting), and also
  // any time another household member's change arrives while this
  // screen is sitting open in the foreground. Reload whenever that
  // actually happens instead of only on navigation/AppState events.
  useEffect(() => onLocalDataChanged(() => load()), [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const recentReceipts = receipts.slice(0, 4);

  const trendPct =
    lastMonthTotal && lastMonthTotal > 0
      ? Math.round(((stats.totalSpent - lastMonthTotal) / lastMonthTotal) * 100)
      : null;

  // Budgets track against what actually left the wallet: each receipt's
  // full totalAmount (tax included), split across the categories of its
  // line items (see lib/budgetSpend.ts) so item-level categories — built-in
  // or custom — count toward their own budgets.
  const categorySpendForBudgets = computeBudgetSpend(receipts);
  const budgetRows = Object.entries(categorySpendForBudgets)
    .filter(([category]) => (budgets[category] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([category, spent]) => ({
      category,
      spent,
      limit: budgets[category],
      status: budgetStatus(spent, budgets[category]),
    }));

  const statusMeta: Record<BudgetStatus, { label: string; color: string; bg: string }> = {
    onTrack: { label: t('onTrack'), color: theme.colors.success, bg: theme.colors.successFaint },
    watch: { label: t('watch'), color: theme.colors.accent, bg: theme.colors.accentTint },
    over: { label: t('over'), color: theme.colors.error, bg: theme.colors.errorFaint },
  };

  // Hero "pace" ring: how much of the WHOLE month's configured budget has
  // been spent so far, using every category budget the user has set (not
  // just the top-3 slice budgetRows truncates to for display below).
  // With no budgets configured at all there's nothing meaningful to show
  // a percentage of, so the ring is hidden entirely rather than rendering
  // a 0%/undefined ring.
  const totalBudget = Object.values(budgets).reduce((s, v) => s + (v > 0 ? v : 0), 0);
  const showPaceRing = totalBudget > 0;
  const paceRatio = showPaceRing ? Math.min(stats.totalSpent / totalBudget, 1) : 0;
  const paceStatus = showPaceRing ? budgetStatus(stats.totalSpent, totalBudget) : 'onTrack';
  const paceColor = statusMeta[paceStatus].color;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />
        }
      >
        {/* Active household + switcher */}
        <View style={styles.householdRow}>
          <TouchableOpacity
            style={styles.householdChip}
            onPress={() => router.push('/households' as never)}
          >
            <Ionicons name="home" size={16} color="#fff" />
            <Text style={styles.householdRowName} numberOfLines={1}>
              {memberships.find((m) => m.householdId === getCurrentHouseholdId())?.name ||
                t('unnamedHousehold')}
            </Text>
            <Ionicons name="swap-horizontal" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
  
        {/* Hero total card */}
        <View style={styles.heroCard}>
          <View style={styles.heroDecorCircle} />
          <Ionicons name="receipt" size={120} color="#fff" style={styles.heroDecorWatermark} />
          <Text style={styles.heroLabel}>{greeting(firstNameOf(user?.displayName, profile), t)}</Text>
          <View style={styles.heroAmountRow}>
            <View style={styles.heroAmountShrinkWrap}>
              <Text
                style={styles.heroAmount}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
              >
                {formatCurrency(stats.totalSpent, currency)}
              </Text>
            </View>
            {showPaceRing && (
              <View style={styles.paceRingWrap}>
                <View style={styles.paceRingCircleWrap}>
                  <RingProgress
                    size={46}
                    strokeWidth={5}
                    pct={paceRatio}
                    color={paceColor}
                    trackColor="rgba(255,255,255,0.16)"
                    testID="pace-ring"
                  />
                  <Text style={styles.paceRingPctText}>{Math.round(paceRatio * 100)}%</Text>
                </View>
                <Text style={styles.paceRingCap}>{t('ofBudget')}</Text>
              </View>
            )}
          </View>
          <View style={styles.monthNavRow}>
            <TouchableOpacity
              onPress={() => setMonthOffset((v) => v - 1)}
              hitSlop={8}
              style={styles.monthNavBtn}
            >
              <Ionicons name="chevron-back" size={16} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
            <Text style={styles.monthNavLabel}>{formatMonthYear(viewedMonth, language)}</Text>
            <TouchableOpacity
              onPress={() => setMonthOffset((v) => v + 1)}
              disabled={isCurrentMonth}
              hitSlop={8}
              style={styles.monthNavBtn}
            >
              <Ionicons
                name="chevron-forward"
                size={16}
                color={isCurrentMonth ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.85)'}
              />
            </TouchableOpacity>
          </View>
          <View style={styles.heroMetaRow}>
            <Text style={styles.heroMetaText}>
              {t(isCurrentMonth ? 'expensesThisMonth' : 'expensesThatMonth', {
                count: stats.receiptCount,
              })}
            </Text>
            {trendPct != null && (
              <View style={styles.trendPill}>
                <Text
                  style={[
                    styles.trendPillText,
                    { color: trendPct <= 0 ? '#9FE0C8' : '#F0B4B6' },
                  ]}
                >
                  {t('pctVsLastMonth', { pct: `${trendPct > 0 ? '+' : ''}${trendPct}` })}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.cashflowStrip}>
            {(() => {
              const scale = Math.max(cashflow.totalEarned, cashflow.totalSpent, 1);
              const earnedPct = Math.max(0.04, cashflow.totalEarned / scale);
              const spentPct = Math.max(0.04, cashflow.totalSpent / scale);
              const monthParams = {
                year: String(viewedMonth.getFullYear()),
                month: String(viewedMonth.getMonth() + 1),
              };
              const openAllIncomes = () =>
                router.push({
                  pathname: '/incomes',
                  params: { ...monthParams },
                });
              const openIncomesByMember = () =>
                router.push({
                  pathname: '/incomes',
                  params: { ...monthParams },
                });
              return (
                <>
                  <TouchableOpacity
                    onPress={openAllIncomes}
                    accessibilityRole="button"
                    accessibilityLabel={t('viewAllIncomes')}
                    testID="cashflow-earned"
                    style={styles.cashflowBarRow}
                  >
                    <View style={styles.cashflowBarHead}>
                      <Text style={styles.cashflowBarLabel}>{t('earned')}</Text>
                      <Text style={styles.cashflowBarValue}>
                        {formatCurrency(cashflow.totalEarned, currency)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={openIncomesByMember}
                    accessibilityRole="button"
                    accessibilityLabel={t('viewIncomesByPerson')}
                    testID="cashflow-bars"
                    style={{ gap: 8 }}
                  >
                    <View style={styles.cashflowTrack}>
                      <View
                        style={[
                          styles.cashflowFill,
                          { width: `${earnedPct * 100}%`, backgroundColor: '#9FE0C8' },
                        ]}
                      />
                    </View>
                    <View style={styles.cashflowTrack}>
                      <View
                        style={[
                          styles.cashflowFill,
                          { width: `${spentPct * 100}%`, backgroundColor: '#F0B4B6' },
                        ]}
                      />
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() =>
                      router.push({
                        pathname: '/(tabs)/history',
                        params: { kind: 'expenses', ...monthParams },
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={t('viewExpenses')}
                    testID="cashflow-spent"
                    style={styles.cashflowBarRow}
                  >
                    <View style={styles.cashflowBarHead}>
                      <Text style={styles.cashflowBarLabel}>{t('spent')}</Text>
                      <Text style={styles.cashflowBarValue}>
                        {formatCurrency(cashflow.totalSpent, currency)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <View style={styles.cashflowBarHead}>
                    <Text style={styles.cashflowBarLabel}>{t('net')}</Text>
                    <Text
                      style={
                        cashflow.net >= 0 ? styles.cashflowNetPositive : styles.cashflowNetNegative
                      }
                    >
                      {formatCurrency(cashflow.net, currency)}
                    </Text>
                  </View>
                </>
              );
            })()}
            {cashflow.investedUsd > 0 ? (
              <Text style={styles.cashflowInvested}>
                {t('investedAmount', { amount: formatCurrency(cashflow.investedUsd, currency) })}
                {cashflow.savingsRate != null
                  ? t('savedPctOfEarned', { pct: (cashflow.savingsRate * 100).toFixed(0) })
                  : ''}
              </Text>
            ) : null}
            {cashflow.byMember.length > 1 ? (
              <View style={styles.cashflowMembers}>
                {cashflow.byMember.map((m) => {
                  const member = members.find((x) => x.uid === m.earnedBy);
                  const name =
                    member?.isYou
                      ? t('you')
                      : member?.displayName?.trim() ||
                        member?.email?.trim() ||
                        (m.earnedBy.length > 8
                          ? `${m.earnedBy.slice(0, 6)}…`
                          : m.earnedBy);
                  return (
                    <TouchableOpacity
                      key={m.earnedBy}
                      onPress={() =>
                        router.push({
                          pathname: '/incomes',
                          params: {
                            earnedBy: m.earnedBy,
                            year: String(viewedMonth.getFullYear()),
                            month: String(viewedMonth.getMonth() + 1),
                          },
                        })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={t('incomeOfName', { name })}
                      style={styles.cashflowMemberRow}
                    >
                      <Text style={styles.cashflowMemberName} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={styles.cashflowMemberAmt}>
                        {formatCurrency(m.total, currency)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </View>
        </View>

        <EarningsInvestmentsCard
          cashflow={cashflow}
          accounts={isPremium ? investments : []}
          currency={currency}
          onPressInvestments={() => router.push('/investments' as never)}
        />

        {/* "Where it went" category composition bar */}
        {stats.categories.length > 0 && (
          <View style={styles.compositionCard}>
            <View style={styles.compositionHead}>
              <Text style={styles.sectionTitle}>{t('whereItWent')}</Text>
              <Text style={styles.compNote}>{t('amountTotal', { amount: formatCurrency(stats.totalSpent, currency) })}</Text>
            </View>
            <View style={styles.compBar}>
              {stats.categories.map((c) => {
                const color = resolveCategoryColor(
                  c.category,
                  theme.colors.category,
                  customCategories,
                  theme.colors.accent,
                );
                return (
                  <View
                    key={c.category}
                    style={[
                      styles.compSegment,
                      { flex: Math.max(c.percentage, 0.001), backgroundColor: color },
                    ]}
                  />
                );
              })}
            </View>
            <View style={styles.compLegend}>
              {stats.categories.slice(0, 4).map((c) => {
                const color = resolveCategoryColor(
                  c.category,
                  theme.colors.category,
                  customCategories,
                  theme.colors.accent,
                );
                return (
                  <View key={c.category} style={styles.compLegendItem}>
                    <View style={[styles.compDot, { backgroundColor: color }]} />
                    <Text style={styles.compLegendText}>
                      {categoryLabel(c.category)} {Math.round(c.percentage)}%
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Quick actions */}
        {reviewCount > 0 && (
          <TouchableOpacity
            testID="review-banner"
            style={styles.reviewBanner}
            onPress={() => router.push('/review' as never)}
            accessibilityRole="button"
          >
            <Ionicons name="checkmark-done-outline" size={20} color={theme.colors.accent} />
            <Text style={styles.reviewBannerText}>
              {t('recurringToReview', { count: reviewCount })}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
          </TouchableOpacity>
        )}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.colors.cardTint.sky }]}
            onPress={() => router.push('/(tabs)/scan?mode=manual' as never)}
          >
            <Ionicons name="add-circle-outline" size={20} color={theme.colors.textPrimary} />
            <Text style={styles.actionBtnText}>{t('addExpense')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.colors.cardTint.mint }]}
            onPress={() => router.push('/add-income' as never)}
          >
            <Ionicons name="cash-outline" size={20} color={theme.colors.textPrimary} />
            <Text style={styles.actionBtnText}>{t('addIncome')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.colors.cardTint.lavender }]}
            onPress={() => router.push('/recurring' as never)}
          >
            <Ionicons name="repeat-outline" size={20} color={theme.colors.textPrimary} />
            <Text style={styles.actionBtnText}>{t('recurring2')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.colors.cardTint.peach }]}
            onPress={() => router.push('/balances' as never)}
          >
            <Ionicons name="wallet-outline" size={20} color={theme.colors.textPrimary} />
            <Text style={styles.actionBtnText}>{t('balances')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.colors.cardTint.lilac }]}
            onPress={() => router.push('/incomes' as never)}
          >
            <Ionicons name="list-outline" size={20} color={theme.colors.textPrimary} />
            <Text style={styles.actionBtnText}>{t('incomes')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.colors.cardTint.sky }]}
            onPress={() => router.push(isPremium ? '/savings-goals' : '/paywall')}
          >
            <Ionicons name="flag-outline" size={20} color={theme.colors.textPrimary} />
            <Text style={styles.actionBtnText}>{isPremium ? t('goals') : t('goalsPro')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="home-investments"
            style={[styles.actionBtn, { backgroundColor: theme.colors.cardTint.mint }]}
            onPress={() => router.push(isPremium ? '/investments' : '/paywall')}
          >
            <Ionicons name="trending-up-outline" size={20} color={theme.colors.textPrimary} />
            <Text style={styles.actionBtnText}>
              {isPremium ? t('investmentsTitle') : t('investmentsPro')}
            </Text>
          </TouchableOpacity>
        </View>
  
        {isPremium && savingsGoals.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('savingsGoals')}</Text>
              <TouchableOpacity onPress={() => router.push('/savings-goals' as never)} hitSlop={8}>
                <Text style={styles.sectionLink}>{t('manage')}</Text>
              </TouchableOpacity>
            </View>
            {savingsGoals.map((goal) => {
              const ratio = goal.targetUsd > 0 ? Math.min(goal.allocatedUsd / goal.targetUsd, 1) : 0;
              return (
                <TouchableOpacity
                  key={goal.id}
                  style={styles.savingsCard}
                  onPress={() => router.push('/savings-goals' as never)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.budgetChipName}>{goal.name}</Text>
                  <Text style={styles.budgetChipAmt}>
                    {t('amountOfAmount', {
                      a: formatCurrency(goal.allocatedUsd, currency),
                      b: formatCurrency(goal.targetUsd, currency),
                    })}
                  </Text>
                  <View style={styles.goalTrack}>
                    <View style={[styles.goalFill, { width: `${ratio * 100}%` }]} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Budgets */}
        {budgetRows.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('budgets')}</Text>
              <TouchableOpacity onPress={() => router.push('/settings?section=budgets' as never)} hitSlop={8}>
                <Text style={styles.sectionLink}>{t('manage')}</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.budgetScrollContent}
            >
              {budgetRows.map((b) => {
                const meta = statusMeta[b.status];
                const catColor =
                  b.category === RECURRING_BUDGET_KEY
                    ? theme.colors.accent
                    : resolveCategoryColor(
                        b.category,
                        theme.colors.category,
                        customCategories,
                        theme.colors.accent,
                      );
                const ratio = b.limit > 0 ? Math.min(b.spent / b.limit, 1) : 0;
                return (
                  <View key={b.category} style={styles.budgetChip}>
                    <View style={styles.budgetChipTopRow}>
                      <RingProgress
                        size={30}
                        strokeWidth={4}
                        pct={ratio}
                        // Same independent-of-status-pill red override the
                        // old linear bar had (see the budgetStatus() doc
                        // comment above) — the ring, not just the pill,
                        // should turn error-red past 90%.
                        color={ratio > 0.9 ? theme.colors.error : catColor}
                        trackColor={theme.colors.surfaceHigh}
                        testID="budget-ring"
                      />
                      <View style={[styles.budgetChipStatusPill, { backgroundColor: meta.bg }]}>
                        <Text style={[styles.budgetChipStatusText, { color: meta.color }]}>
                          {meta.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.budgetChipName} numberOfLines={1}>
                      {categoryLabel(b.category)}
                    </Text>
                    <Text style={styles.budgetChipAmt}>
                      {t('amountOfAmount', {
                        a: formatCurrency(b.spent, currency),
                        b: formatCurrency(b.limit, currency),
                      })}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}
  
        {/* Recent expenses */}
        {recentReceipts.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{t('recent')}</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/history' as never)} hitSlop={8}>
                <Text style={styles.sectionLink}>{t('seeAll')}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.list}>
              {recentReceipts.map((r) => {
                const color = resolveCategoryColor(
                  r.category,
                  theme.colors.category,
                  customCategories,
                  theme.colors.accent,
                );
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.row}
                    activeOpacity={0.8}
                    onPress={() => router.push(`/edit/${r.id}` as never)}
                  >
                    <View style={styles.rowLeft}>
                      <View style={[styles.avatar, { backgroundColor: `${color}26` }]}>
                        <Text style={styles.avatarText}>
                          {categoryIcon(r.category, '🧾')}
                        </Text>
                      </View>
                      <View style={styles.rowInfo}>
                        <Text style={styles.merchantName} numberOfLines={1}>
                          {r.storeName}
                        </Text>
                        <Text style={styles.rowMeta}>
                          {categoryLabel(r.category)} · {dateLabel(new Date(r.date), language)}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.rowAmount}>{formatCurrency(r.totalAmount, currency)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
  
        {receipts.length === 0 && (
          <EmptyState
            icon="receipt-outline"
            title={t('noReceiptsYet')}
            description={t('tapTheCameraButtonBelow')}
            actionLabel={t('scanAReceipt')}
            onAction={() => router.push('/(tabs)/scan')}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
