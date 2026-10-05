import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  LayoutChangeEvent,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import { useStyles, useTheme, useThemePreference } from '../constants/theme';
import { ThemePreference } from '../lib/secureStorage';

const THEME_OPTIONS: { value: ThemePreference; labelKey: 'themeLight' | 'themeDark' | 'themeSystem' }[] = [
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
  { value: 'system', labelKey: 'themeSystem' },
];
const LANGUAGE_OPTIONS: LanguagePreference[] = ['system', 'en', 'fr'];
const REQUEST_TIMEOUT_MS = 15000;
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { categoryLabel } from '../lib/categoryLabel';
import { ALL_CATEGORIES } from '../constants/categories';
import { useAuth } from '../lib/AuthContext';
import { useEntitlements } from '../lib/EntitlementsContext';
import { getManagementUrl } from '../lib/entitlements';
import {
  getBudgetAlertsEnabled,
  getBudgetsSnapshot,
  getCategoryBudgets,
  getCurrency,
  setBudgetAlertsEnabled as persistBudgetAlertsEnabled,
  setCategoryBudget,
  setCurrency as persistCurrency,
} from '../lib/secureStorage';
import { getAllReceipts, getCurrentHouseholdId } from '../lib/database';
import { humanizeAuthError } from '../lib/authErrors';
import { registerForPushNotificationsAsync, requestNotificationPermission } from '../lib/notifications';
import {
  getHouseholdMembers,
  inviteUserToHousehold,
  isCloudSyncAvailable,
  leaveHousehold,
  syncBudgetsToCloud,
  syncCustomCategoriesToCloud,
  syncPushTokenToCloud,
  type HouseholdMember,
} from '../lib/cloudSync';
import { receiptsToCsv } from '../lib/reports';
import { RECURRING_BUDGET_KEY } from '../lib/recurring';
import { suggestEmailCompletions } from '../lib/emailSuggestions';
import { withTimeout } from '../lib/withTimeout';
import { LegalLinksRow } from '../components/ui/LegalLinksRow';
import { Ionicons } from '@expo/vector-icons';
import { CustomCategoryPicker } from '../components/ui/CustomCategoryPicker';
import {
  getCustomCategories,
  getCustomCategoriesSynced,
  removeCustomCategory,
  setCustomCategoriesSynced,
  type CustomCategory,
} from '../lib/customCategories';
import {
  CURRENCIES,
  CURRENCY_SYMBOLS,
  convertFromUsd,
  convertToUsd,
  currencyDecimals,
  formatCurrency,
  hasLiveRates,
  isPremiumCurrency,
  type CurrencyCode,
} from '../lib/currency';
import { Category } from '../types';

import { useT, useLanguage } from '../lib/I18nContext';
import { LANGUAGE_NAMES, type LanguagePreference } from '../lib/i18n';
import { intlLocale } from '../lib/dateLocale';
function useSettingsStyles() {
  return useStyles((theme) => ({
    container: { flex: 1, backgroundColor: theme.colors.background },
    scroll: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: 100,
    },
    screenTitle: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.xxxl,
      fontFamily: theme.fonts.display.extraBold,
      marginBottom: theme.spacing.lg,
    },
    section: {
      marginBottom: theme.spacing.lg,
    },
    sectionTitle: {
      color: theme.colors.textSecondary,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.display.bold,
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginBottom: theme.spacing.sm,
      paddingHorizontal: theme.spacing.xs,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: 20,
      overflow: 'hidden',
      shadowColor: theme.isDark ? '#000' : '#0C0F24',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: theme.isDark ? 0.4 : 0.08,
      shadowRadius: 10,
      elevation: 2,
    },
    profileHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
    },
    avatar: {
      width: 48,
      height: 48,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      // Dark-navy fill blends into the dark-mode card; a light-toned
      // border in dark mode keeps the avatar readable as its own shape.
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.colors.borderLight : 'transparent',
    },
    avatarInitials: {
      color: '#FFFFFF',
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    profileName: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.lg,
      fontFamily: theme.fonts.display.bold,
    },
    profileMeta: {
      color: theme.colors.textMuted,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.body.regular,
      marginTop: 2,
    },
    signOutTextBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.md,
    },
    signOutTextLabel: {
      color: theme.colors.error,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    currencyRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.xs,
      flexWrap: 'wrap',
    },
    currencyPill: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 8,
    },
    currencyPillActive: {
      backgroundColor: theme.colors.success,
      // In dark mode, override the border so the pill's shape stays
      // visible against the dark-mode page instead of blending in.
      borderColor: theme.isDark ? theme.colors.borderLight : theme.colors.success,
    },
    currencyPillText: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
    currencyPillTextActive: {
      color: '#FFFFFF',
    },
    currencyCaption: {
      color: theme.colors.textMuted,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      marginTop: theme.spacing.sm,
      paddingHorizontal: theme.spacing.xs,
      lineHeight: 16,
    },
    budgetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      gap: theme.spacing.sm,
    },
    categoryDot: {
      width: 10,
      height: 10,
      borderRadius: theme.radius.full,
    },
    categoryName: {
      flex: 1,
      color: theme.colors.textPrimary,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    budgetInputBox: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      backgroundColor: theme.colors.background,
    },
    budgetCurrencyPrefix: {
      color: theme.colors.textMuted,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.mono.regular,
      marginRight: 2,
    },
    budgetInput: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.mono.medium,
      minWidth: 44,
      padding: 0,
      textAlign: 'right',
    },
    alertRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 14,
    },
    alertLabel: {
      color: theme.colors.textPrimary,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    budgetAlertsSwitch: {
      // Native Switch has no width/height props — the design spec calls
      // for a 40x24px pill, close to the default ~51x31 control, so we
      // scale it down instead of reimplementing a custom pill toggle.
      transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
    },
    memberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      gap: theme.spacing.sm,
    },
    memberAvatar: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      // Dark-navy fill blends into the dark-mode row; a light-toned
      // border in dark mode keeps the avatar readable as its own shape.
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.colors.borderLight : 'transparent',
    },
    memberAvatarInitials: {
      color: '#FFFFFF',
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
    memberName: {
      flex: 1,
      color: theme.colors.textPrimary,
      fontSize: theme.font.md,
      fontFamily: theme.fonts.display.bold,
    },
    memberRoleBadge: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.full,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    memberRoleText: {
      color: theme.colors.textMuted,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.display.bold,
      textTransform: 'uppercase',
    },
    inviteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    inviteInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 10,
      color: theme.colors.textPrimary,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.body.regular,
      backgroundColor: theme.colors.background,
    },
    inviteSendBtn: {
      backgroundColor: theme.colors.primary,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
      // Dark-navy fill blends into the dark-mode row; a light-toned
      // border in dark mode keeps the button readable as its own shape.
      borderWidth: theme.isDark ? 1 : 0,
      borderColor: theme.isDark ? theme.colors.borderLight : 'transparent',
    },
    inviteSendBtnDisabled: {
      opacity: 0.5,
    },
    inviteSendText: {
      color: '#FFFFFF',
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
    emailSuggestionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.md,
      marginTop: -4,
      marginBottom: 4,
    },
    emailSuggestionChip: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.full,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      backgroundColor: theme.colors.background,
    },
    emailSuggestionText: {
      color: theme.colors.accent,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
    },
    inviteHint: {
      color: theme.colors.textMuted,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      marginTop: 6,
      marginBottom: 4,
    },
    cloudSyncWarning: {
      color: theme.colors.error,
      fontSize: theme.font.xs,
      fontFamily: theme.fonts.body.regular,
      marginBottom: theme.spacing.sm,
    },
    leaveHouseholdBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border,
    },
    leaveHouseholdText: {
      color: theme.colors.textMuted,
      fontSize: theme.font.sm,
      fontFamily: theme.fonts.display.bold,
    },
  }));
}

export default function SettingsScreen() {
  const t = useT();
  const theme = useTheme();
  const { preference: themePreference, setPreference: setThemePreference } = useThemePreference();
  const { language, preference: languagePreference, setPreference: setLanguagePreference } = useLanguage();
  const styles = useSettingsStyles();
  const router = useRouter();
  const { section, category: focusCategory } = useLocalSearchParams<{ section?: string; category?: string }>();
  const scrollRef = React.useRef<ScrollView>(null);
  const budgetsSectionY = React.useRef(0);
  // Budget-row geometry for deep-linking to one category's row
  // (/settings?section=budgets&category=Groceries): the card's offset inside
  // the section plus each row's offset inside the card, and the inputs so the
  // target row can be focused for editing.
  const budgetsCardY = React.useRef(0);
  const budgetRowY = React.useRef<Record<string, number>>({});
  const budgetInputRefs = React.useRef<Record<string, TextInput | null>>({});
  const budgetRowProps = (key: string) => ({
    onLayout: (e: LayoutChangeEvent) => {
      budgetRowY.current[key] = e.nativeEvent.layout.y;
    },
  });
  const budgetInputRef = (key: string) => (el: TextInput | null) => {
    budgetInputRefs.current[key] = el;
  };
  const { user, profile, signOut, deleteAccount, refreshProfile, setActiveHousehold } = useAuth();
  const { isPremium, promoRedemption } = useEntitlements();
  const toast = useToast();
  const [openingManageSubscription, setOpeningManageSubscription] = useState(false);

  const onManageSubscription = async () => {
    if (openingManageSubscription) return;
    setOpeningManageSubscription(true);
    try {
      const url = await getManagementUrl();
      if (url) {
        await Linking.openURL(url);
      } else {
        toast.show({ kind: 'error', message: t('couldnTFindYourSubscription') });
      }
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? t('couldnTOpenSubscriptionManagement') });
    } finally {
      setOpeningManageSubscription(false);
    }
  };

  // Per-category budget amounts (canonical USD) and the "notify near
  // limit" toggle are persisted via lib/secureStorage
  // (getCategoryBudgets/setCategoryBudget, getBudgetAlertsEnabled/
  // setBudgetAlertsEnabled) — the same store the dashboard reads from.
  const [categoryBudgetsUsd, setCategoryBudgetsUsd] = useState<Record<string, number>>({});
  const [budgetInputs, setBudgetInputs] = useState<Record<string, string>>({});
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [budgetAlertsEnabled, setBudgetAlertsEnabledState] = useState(false);
  const [exportingAll, setExportingAll] = useState(false);
  const [currency, setCurrencyState] = useState<CurrencyCode>('USD');

  // Household membership (Phase 3 split feature). Loaded from Firestore
  // via getHouseholdMembers — null while loading, [] if cloud sync isn't
  // available (or the household has no doc yet).
  const [members, setMembers] = useState<HouseholdMember[] | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitingSending, setInviteSending] = useState(false);
  const [leavingHousehold, setLeavingHousehold] = useState(false);
  // Local-only echo of the last invite this device successfully sent —
  // NOT a query of pending invites (Firestore only tracks one pending
  // invite per invitee email, not per-sender). Exists purely so "Send"
  // gives visible confirmation beyond a toast that can be missed,
  // since sending an invite never changes `members` (the invitee only
  // joins once THEY sign in and accept).
  const [lastInvitedEmail, setLastInvitedEmail] = useState<string | null>(null);

  const loadMembers = React.useCallback(async () => {
    const householdId = getCurrentHouseholdId();
    if (!householdId || !user?.uid) {
      setMembers(null);
      return;
    }
    const result = await getHouseholdMembers({ householdId, currentUid: user.uid });
    setMembers(result);
  }, [user?.uid]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // Deep-linked from Home's "Manage" budget link (/settings?section=budgets)
  // — scroll straight to the Categories & budgets section once its layout
  // is measured, instead of landing at the top of a long Settings screen.
  // Re-runs when `members` resolves too: the Household section above
  // budgets grows once member data arrives (see its `members.length > 1`
  // branch), which shifts budgetsSectionY — re-scrolling here picks up
  // that new position instead of leaving the very first (now-stale) one.
  // Consumes the deep link via `didAutoScrollRef` — Settings is a tab
  // (never remounts) and `loadMembers()` reruns on every focus with a
  // fresh array reference, so without this guard every later focus of
  // this screen would re-fire the scroll and yank the user back to
  // budgets even after they'd scrolled elsewhere themselves. But it only
  // latches once `members` has resolved at least once (initial state is
  // `null`) — scrolling before then would use a Y measured before the
  // Household section had a chance to grow, and latching immediately
  // would leave that wrong position stuck for good on a slow fetch.
  const didAutoScrollRef = React.useRef(false);
  useEffect(() => {
    didAutoScrollRef.current = false;
  }, [section, focusCategory]);
  useEffect(() => {
    if (section !== 'budgets' || didAutoScrollRef.current) return;
    const timer = setTimeout(() => {
      const rowY = focusCategory ? budgetRowY.current[focusCategory] : undefined;
      const y =
        rowY !== undefined
          ? Math.max(0, budgetsSectionY.current + budgetsCardY.current + rowY - 120)
          : budgetsSectionY.current;
      scrollRef.current?.scrollTo({ y, animated: true });
      // Latch only once the members have resolved AND (when a row was asked
      // for) that row has been laid out — custom-category rows appear after
      // an async load, and latching on the section-top fallback would leave
      // the effect unable to retry when the row finally renders.
      const rowReady = !focusCategory || rowY !== undefined;
      if (members !== null && rowReady) {
        didAutoScrollRef.current = true;
        if (focusCategory) setTimeout(() => budgetInputRefs.current[focusCategory]?.focus(), 400);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [section, focusCategory, members, customCategories]);

  const sendInvite = async () => {
    const householdId = getCurrentHouseholdId();
    if (!householdId || !user?.uid) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteSending(true);
    try {
      const res = await withTimeout(
        inviteUserToHousehold({
          email,
          householdId,
          invitedByUid: user.uid,
          invitedByEmail: user.email ?? null,
          invitedByName: profile ? `${profile.firstName} ${profile.lastName}`.trim() : null,
          budgets: await getBudgetsSnapshot(householdId),
        }),
        REQUEST_TIMEOUT_MS,
      );
      if (res.ok) {
        toast.show({ kind: 'success', message: t('inviteSent') });
        setLastInvitedEmail(email);
        setInviteEmail('');
      } else {
        toast.show({ kind: 'error', message: res.reason || t('couldnTSendInvite') });
      }
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? t('couldnTSendInvite') });
    } finally {
      setInviteSending(false);
    }
  };

  const confirmLeaveHousehold = () => {
    Alert.alert(t('leaveHousehold'), t('youWillMoveToYour'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('leave'), style: 'destructive', onPress: () => doLeaveHousehold() },
    ]);
  };

  const doLeaveHousehold = async () => {
    const householdId = getCurrentHouseholdId();
    if (!householdId || !user?.uid || leavingHousehold) return;
    setLeavingHousehold(true);
    try {
      const res = await withTimeout(
        leaveHousehold({
          uid: user.uid,
          householdId,
          email: user.email ?? null,
          displayName: profile ? `${profile.firstName} ${profile.lastName}`.trim() : null,
        }),
        REQUEST_TIMEOUT_MS,
      );
      if (res.ok) {
        await setActiveHousehold(res.nextActiveHouseholdId);
        toast.show({ kind: 'success', message: t('youLeftTheHousehold') });
        await loadMembers();
      } else {
        toast.show({ kind: 'error', message: res.reason || t('couldnTLeaveHousehold') });
      }
    } catch (e) {
      toast.show({ kind: 'error', message: (e as Error)?.message ?? t('couldnTLeaveHousehold') });
    } finally {
      setLeavingHousehold(false);
    }
  };

  const memberInitials = (m: HouseholdMember): string => {
    const label = m.displayName || m.email || '';
    const parts = label.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return '·';
  };

  // Re-runs on every focus (not just mount) so returning from the
  // Households switcher screen reloads THIS household's budgets —
  // Settings is a tab and doesn't remount on navigation.
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      (async () => {
        const householdId = getCurrentHouseholdId();
        if (!householdId) return;
        const [budgets, alertsEnabled, storedCurrency, customs] = await Promise.all([
          getCategoryBudgets(householdId),
          getBudgetAlertsEnabled(householdId),
          getCurrency(),
          getCustomCategories(householdId).catch(() => [] as CustomCategory[]),
        ]);
        if (!mounted) return;
        setCustomCategories(customs);
        // One-time push of categories created before cloud sync existed.
        try {
          if (customs.length > 0 && !(await getCustomCategoriesSynced(householdId))) {
            if (await syncCustomCategoriesToCloud(householdId, { add: customs })) {
              await setCustomCategoriesSynced(householdId);
            }
          }
        } catch {
          // best-effort; retried on the next focus
        }
        const nextCurrency: CurrencyCode =
          storedCurrency && (CURRENCIES as string[]).includes(storedCurrency)
            ? (storedCurrency as CurrencyCode)
            : 'USD';
        setCategoryBudgetsUsd(budgets);
        setBudgetInputs(
          Object.fromEntries(
            Object.entries(budgets).map(([cat, amountUsd]) => [
              cat,
              formatBudgetInput(convertFromUsd(amountUsd, nextCurrency), nextCurrency),
            ]),
          ),
        );
        setBudgetAlertsEnabledState(alertsEnabled);
        setCurrencyState(nextCurrency);
        await loadMembers();
      })();
      return () => {
        mounted = false;
      };
    }, [loadMembers]),
  );

  const selectCurrency = (code: CurrencyCode) => {
    if (code === currency) return;
    if (isPremiumCurrency(code) && !isPremium) {
      router.push('/paywall');
      return;
    }
    setCurrencyState(code);
    persistCurrency(code);
    // Re-render every budget input converted into the newly selected
    // currency — the canonical USD amount underneath doesn't change.
    setBudgetInputs(
      Object.fromEntries(
        Object.entries(categoryBudgetsUsd).map(([cat, amountUsd]) => [
          cat,
          formatBudgetInput(convertFromUsd(amountUsd, code), code),
        ]),
      ),
    );
  };

  // Mirrors the just-changed budgets onto the household doc so every
  // OTHER member — new or already in the household — converges to the
  // same amounts via subscribeToHouseholdBudgets (lib/AuthContext.tsx),
  // not just brand-new invitees getting a one-time copy at join time.
  const pushBudgetsToCloud = (byCategory: Record<string, number>, alertsEnabled: boolean) => {
    const householdId = getCurrentHouseholdId();
    if (!householdId) return;
    void syncBudgetsToCloud(householdId, { byCategory, alertsEnabled });
  };

  const updateCategoryBudget = (cat: string, value: string) => {
    setBudgetInputs((prev) => ({ ...prev, [cat]: value }));
    const parsed = parseFloat(value);
    const householdId = getCurrentHouseholdId();
    if (!Number.isNaN(parsed) && parsed >= 0 && householdId) {
      const amountUsd = convertToUsd(parsed, currency);
      const nextBudgets = { ...categoryBudgetsUsd, [cat]: amountUsd };
      setCategoryBudgetsUsd(nextBudgets);
      setCategoryBudget(householdId, cat, amountUsd);
      pushBudgetsToCloud(nextBudgets, budgetAlertsEnabled);
    }
  };

  const toggleBudgetAlerts = async (enabled: boolean) => {
    // The toggle itself just represents "I want alerts" and is always
    // persisted as chosen. Turning it ON additionally kicks off the OS
    // permission handshake — turning it OFF never prompts for anything.
    const householdId = getCurrentHouseholdId();
    setBudgetAlertsEnabledState(enabled);
    if (householdId) persistBudgetAlertsEnabled(householdId, enabled);
    pushBudgetsToCloud(categoryBudgetsUsd, enabled);
    if (enabled) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        toast.show({
          kind: 'error',
          message:
            t('notificationsAreTurnedOffFor'),
        });
        return;
      }
      // Register right away instead of waiting for the next sign-in —
      // other household members' devices push THIS token as soon as
      // their own activity (over-budget, a shared expense, settling
      // up) happens, so it shouldn't sit unset until next app launch.
      const token = await registerForPushNotificationsAsync();
      if (token && user?.uid) void syncPushTokenToCloud(user.uid, token);
    }
  };

  /**
   * Exports every receipt on this device/household as a single CSV —
   * reuses the same `getAllReceipts` + `receiptsToCsv` + share-sheet
   * pattern already proven out in Reports' date-range export
   * (app/reports.tsx), just without the date filter. Lazily requires
   * expo-sharing so this doesn't crash on a build where the native
   * module isn't linked yet; falls back to reporting the saved path.
   */
  const exportAllData = async () => {
    if (exportingAll) return;
    setExportingAll(true);
    try {
      const receipts = await getAllReceipts();
      if (receipts.length === 0) {
        Alert.alert(t('nothingToExport'), t('scanAFewReceiptsBefore2'));
        return;
      }
      const csv = receiptsToCsv(receipts, currency);
      const filename = `NestExpenseTracker All Data - ${new Date().toISOString().slice(0, 10)}.csv`;
      const path = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });

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
        await Sharing.shareAsync(path, {
          mimeType: 'text/csv',
          dialogTitle: t('exportAllData'),
          UTI: 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert(
          t('saved'),
          t('sharingUnavailableWithPathShort', { path }),
        );
      }
    } catch (e) {
      Alert.alert(t('exportFailed'), (e as Error)?.message ?? t('tryAgain'));
    } finally {
      setExportingAll(false);
    }
  };

  const confirmSignOut = () => {
    Alert.alert(t('signOut'), t('youWillNeedToSign'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('signOut2'),
        style: 'destructive',
        onPress: () => {
          // iOS: wait for UIAlertController to finish dismissing before
          // native sign-out / stack changes — AuthContext also waits
          // 500ms on iOS for the same reason.
          setTimeout(() => {
            signOut().catch((e) => {
              toast.show({ kind: 'error', message: humanizeAuthError(e) });
            });
          }, 0);
        },
      },
    ]);
  };

  const confirmDeleteAccount = () => {
    Alert.alert(
      t('deleteAccount'),
      t('thisPermanentlyDeletesYourAccount'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('deleteAccount2'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
            } catch (e) {
              toast.show({
                kind: 'error',
                message: (e as Error)?.message ?? t('failedToDeleteAccountTry'),
              });
            }
          },
        },
      ],
    );
  };

  // Initials shown on the navy avatar circle — e.g. "John Doe" -> "JD".
  const initials = profile
    ? `${profile.firstName?.trim()?.[0] ?? ''}${profile.lastName?.trim()?.[0] ?? ''}`.toUpperCase()
    : (user?.displayName ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase();

  const emailSuggestions = suggestEmailCompletions(inviteEmail);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
        <Text style={styles.screenTitle}>{t('settings')}</Text>

        <Section title={t('profile')}>
          <View style={styles.profileHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarInitials}>{initials || '·'}</Text>
            </View>
            <View style={{ flex: 1, marginLeft: theme.spacing.md }}>
              <Text style={styles.profileName} numberOfLines={1}>
                {profile
                  ? `${profile.firstName} ${profile.lastName}`.trim()
                  : user?.displayName || t('signedIn')}
              </Text>
              <Text style={styles.profileMeta} numberOfLines={1}>
                {user?.email ?? ''}
              </Text>
              {profile?.phone ? (
                <Text style={styles.profileMeta} numberOfLines={1}>
                  {profile.phone}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={{ paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md }}>
            <Pressable
              onPress={() => router.push('/edit-profile')}
              style={styles.leaveHouseholdBtn}
              hitSlop={4}
            >
              <Text style={styles.leaveHouseholdText}>{t('editProfile2')}</Text>
            </Pressable>
          </View>
        </Section>

        <Section title={t('premium')}>
          <View style={{ padding: theme.spacing.md, gap: theme.spacing.sm }}>
            <Text style={styles.profileMeta}>
              {isPremium
                ? promoRedemption
                  ? promoRedemption.grantsPro
                    ? t('premiumUnlockedViaPromoCode')
                    : t('premiumViaPromoUntil', { date: promoRedemption.freeUntil?.toLocaleDateString(intlLocale(language)) ?? '' })
                  : t('youHaveUnlimitedAiScans')
                : t('unlockUnlimitedAiScansPdf')}
            </Text>
            {isPremium ? (
              // A promo-only grant has no real store subscription to
              // manage — only show the link when Premium is actually
              // coming from a subscription.
              !promoRedemption && (
                <Pressable
                  onPress={onManageSubscription}
                  disabled={openingManageSubscription}
                  style={[styles.leaveHouseholdBtn, { borderTopWidth: 0 }]}
                  hitSlop={4}
                >
                  <Text style={styles.leaveHouseholdText}>
                    {openingManageSubscription ? t('opening') : t('manageSubscription')}
                  </Text>
                </Pressable>
              )
            ) : (
              <Button label={t('upgradeToPremium')} onPress={() => router.push('/paywall')} size="lg" />
            )}
          </View>
        </Section>

        <Section title={t('household')}>
          {!isCloudSyncAvailable() && (
            <Text style={styles.cloudSyncWarning}>
              {t('cloudSyncIsnTAvailable')}
            </Text>
          )}
          {(members ?? [{ uid: user?.uid ?? 'you', email: user?.email ?? null, displayName: profile ? `${profile.firstName} ${profile.lastName}`.trim() : null, role: 'owner' as const, isYou: true }]).map(
            (m) => {
              const row = (
                <>
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarInitials}>{memberInitials(m)}</Text>
                  </View>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {m.displayName || m.email || t('householdMember')}
                  </Text>
                  <View style={styles.memberRoleBadge}>
                    <Text style={styles.memberRoleText}>
                      {m.isYou ? t('you') : m.role === 'owner' ? t('owner') : t('member2')}
                    </Text>
                  </View>
                </>
              );
              return m.isYou ? (
                <View key={m.uid} style={styles.memberRow}>
                  {row}
                </View>
              ) : (
                <Pressable
                  key={m.uid}
                  style={styles.memberRow}
                  onPress={() => router.push(`/shared-expenses/${m.uid}`)}
                >
                  {row}
                </Pressable>
              );
            },
          )}

          <View style={styles.inviteRow}>
            <TextInput
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder={t('inviteByEmail')}
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.inviteInput}
            />
            <Pressable
              onPress={sendInvite}
              disabled={invitingSending || !inviteEmail.trim()}
              style={[
                styles.inviteSendBtn,
                (invitingSending || !inviteEmail.trim()) && styles.inviteSendBtnDisabled,
              ]}
            >
              <Text style={styles.inviteSendText}>{invitingSending ? t('sending') : t('send')}</Text>
            </Pressable>
          </View>
          {emailSuggestions.length > 0 && (
            <View style={styles.emailSuggestionRow}>
              {emailSuggestions.map((suggestion) => (
                <Pressable
                  key={suggestion}
                  onPress={() => setInviteEmail(suggestion)}
                  style={styles.emailSuggestionChip}
                >
                  <Text style={styles.emailSuggestionText} numberOfLines={1}>
                    {suggestion}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          {lastInvitedEmail && (
            <Text style={styles.inviteHint}>
              {t('inviteSentHint', { email: lastInvitedEmail })}
            </Text>
          )}

          <Pressable
            onPress={() => router.push('/contacts-sync')}
            style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }}
          >
            <Text
              style={{
                color: theme.colors.accent,
                fontSize: theme.font.sm,
                fontFamily: theme.fonts.display.bold,
              }}
            >
              {t('addByPhoneContact')}
            </Text>
          </Pressable>

          {members && members.length > 1 ? (
            <Pressable
              onPress={confirmLeaveHousehold}
              style={styles.leaveHouseholdBtn}
              disabled={leavingHousehold}
              hitSlop={4}
            >
              <Text style={styles.leaveHouseholdText}>
                {leavingHousehold ? t('leaving') : t('leaveHousehold2')}
              </Text>
            </Pressable>
          ) : null}
        </Section>

        <Section title={t('appearance')}>
          <View style={{ paddingVertical: theme.spacing.sm }}>
            <View style={styles.currencyRow}>
              {THEME_OPTIONS.map(({ value, labelKey }) => {
                const active = value === themePreference;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setThemePreference(value)}
                    style={[styles.currencyPill, active && styles.currencyPillActive]}
                  >
                    <Text
                      style={[
                        styles.currencyPillText,
                        active && styles.currencyPillTextActive,
                      ]}
                    >
                      {t(labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Section>

        <Section title={t('language')}>
          <View style={{ paddingVertical: theme.spacing.sm }}>
            <View style={styles.currencyRow}>
              {LANGUAGE_OPTIONS.map((value) => {
                const active = value === languagePreference;
                return (
                  <Pressable
                    key={value}
                    testID={`language-${value}`}
                    onPress={() => setLanguagePreference(value)}
                    style={[styles.currencyPill, active && styles.currencyPillActive]}
                  >
                    <Text
                      style={[
                        styles.currencyPillText,
                        active && styles.currencyPillTextActive,
                      ]}
                    >
                      {value === 'system' ? t('themeSystem') : LANGUAGE_NAMES[value]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Section>

        <Section title={t('profileCurrency')}>
          <View style={{ paddingVertical: theme.spacing.sm }}>
            <View style={styles.currencyRow}>
              {CURRENCIES.map((code) => {
                const active = code === currency;
                return (
                  <Pressable
                    key={code}
                    onPress={() => selectCurrency(code)}
                    style={[styles.currencyPill, active && styles.currencyPillActive]}
                  >
                    <Text
                      style={[
                        styles.currencyPillText,
                        active && styles.currencyPillTextActive,
                      ]}
                    >
                      {isPremiumCurrency(code) && !isPremium ? `${code} 🔒` : code}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.currencyCaption}>
              {isPremium && hasLiveRates() ? t('amountsShownInLive', { currency }) : t('amountsShownIn', { currency })}
            </Text>
          </View>
        </Section>

        <Section
          title={t('categoriesBudgets')}
          onLayout={(e) => {
            budgetsSectionY.current = e.nativeEvent.layout.y;
          }}
          onCardLayout={(e) => {
            budgetsCardY.current = e.nativeEvent.layout.y;
          }}
        >
          {ALL_CATEGORIES.filter((cat) => cat !== RECURRING_BUDGET_KEY).map((cat: Category) => (
            <View key={cat} style={styles.budgetRow} {...budgetRowProps(cat)}>
              <View
                style={[styles.categoryDot, { backgroundColor: theme.colors.category[cat] }]}
              />
              <Text style={styles.categoryName} numberOfLines={1}>
                {categoryLabel(cat)}
              </Text>
              <View style={styles.budgetInputBox}>
                <Text style={styles.budgetCurrencyPrefix}>{CURRENCY_SYMBOLS[currency]}</Text>
                <TextInput
                  ref={budgetInputRef(cat)}
                  value={budgetInputs[cat] ?? ''}
                  onChangeText={(v) => updateCategoryBudget(cat, v)}
                  placeholder="0"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardType="numeric"
                  style={styles.budgetInput}
                />
              </View>
            </View>
          ))}
          {/* Custom categories are shared with the whole household, so every
              member can see them and set their budget; only Premium
              members can create or remove them. */}
          {customCategories.map((c) => (
            <View
              key={c.name}
              style={styles.budgetRow}
              testID={`custom-budget-row-${c.name}`}
              {...budgetRowProps(c.name)}
            >
              <View style={[styles.categoryDot, { backgroundColor: c.color }]} />
              <Text style={styles.categoryName} numberOfLines={1}>
                {c.name}
              </Text>
              <View style={styles.budgetInputBox}>
                <Text style={styles.budgetCurrencyPrefix}>{CURRENCY_SYMBOLS[currency]}</Text>
                <TextInput
                  ref={budgetInputRef(c.name)}
                  value={budgetInputs[c.name] ?? ''}
                  onChangeText={(v) => updateCategoryBudget(c.name, v)}
                  placeholder="0"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardType="numeric"
                  style={styles.budgetInput}
                />
              </View>
              {isPremium && (
                <Pressable
                  testID={`custom-remove-${c.name}`}
                  onPress={async () => {
                    const hid = getCurrentHouseholdId();
                    if (!hid) return;
                    setCustomCategories(await removeCustomCategory(hid, c.name));
                    void syncCustomCategoriesToCloud(hid, { remove: [c] });
                    // Drop its budget too — with the row gone the user
                    // could never clear a leftover limit otherwise.
                    if (categoryBudgetsUsd[c.name] > 0) {
                      const nextBudgets = { ...categoryBudgetsUsd, [c.name]: 0 };
                      setCategoryBudgetsUsd(nextBudgets);
                      setBudgetInputs((prev) => ({ ...prev, [c.name]: '' }));
                      setCategoryBudget(hid, c.name, 0);
                      pushBudgetsToCloud(nextBudgets, budgetAlertsEnabled);
                    }
                  }}
                  hitSlop={8}
                  accessibilityLabel={`Remove ${c.name}`}
                >
                  <Ionicons name="close-circle-outline" size={20} color={theme.colors.textMuted} />
                </Pressable>
              )}
            </View>
          ))}
          {isPremium ? (
            <CustomCategoryPicker
              householdId={getCurrentHouseholdId()}
              customs={[]}
              selected=""
              isPremium
              onSelect={() => {}}
              onCustomsChange={setCustomCategories}
              onUpgrade={() => {}}
            />
          ) : (
            <Pressable
              testID="custom-categories-locked"
              onPress={() => router.push('/paywall')}
              style={styles.leaveHouseholdBtn}
              hitSlop={4}
            >
              <Text style={styles.leaveHouseholdText}>{t('customCategoriesBudgetsPremium')}</Text>
            </Pressable>
          )}
          {/* Not a receipt category — a separate axis covering ALL
              recurring expenses regardless of their own category, so a
              "how much am I auto-committed to every month" limit can be
              tracked apart from any one category's limit. */}
          <View style={styles.budgetRow} {...budgetRowProps(RECURRING_BUDGET_KEY)}>
            <View style={[styles.categoryDot, { backgroundColor: theme.colors.accent }]} />
            <Text style={styles.categoryName} numberOfLines={1}>
              {RECURRING_BUDGET_KEY}
            </Text>
            <View style={styles.budgetInputBox}>
              <Text style={styles.budgetCurrencyPrefix}>{CURRENCY_SYMBOLS[currency]}</Text>
              <TextInput
                ref={budgetInputRef(RECURRING_BUDGET_KEY)}
                value={budgetInputs[RECURRING_BUDGET_KEY] ?? ''}
                onChangeText={(v) => updateCategoryBudget(RECURRING_BUDGET_KEY, v)}
                placeholder="0"
                placeholderTextColor={theme.colors.textMuted}
                keyboardType="numeric"
                style={styles.budgetInput}
              />
            </View>
          </View>
          <Pressable
            onPress={() => router.push('/recurring' as never)}
            style={styles.leaveHouseholdBtn}
            hitSlop={4}
          >
            <Text style={styles.leaveHouseholdText}>{t('viewRecurringSchedule')}</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/incomes' as never)}
            style={styles.leaveHouseholdBtn}
            hitSlop={4}
          >
            <Text style={styles.leaveHouseholdText}>{t('allIncomes')}</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push(isPremium ? '/savings-goals' : '/paywall')}
            style={styles.leaveHouseholdBtn}
            hitSlop={4}
          >
            <Text style={styles.leaveHouseholdText}>
              {isPremium ? t('savingsGoals') : t('savingsGoalsPremium')}
            </Text>
          </Pressable>
          <Pressable
            testID="settings-investments"
            onPress={() => router.push(isPremium ? '/investments' : '/paywall')}
            style={styles.leaveHouseholdBtn}
            hitSlop={4}
          >
            <Text style={styles.leaveHouseholdText}>
              {isPremium ? t('investmentsTitle') : t('investmentsPro')}
            </Text>
          </Pressable>
          <View style={styles.alertRow}>
            {/* Now the single on/off switch for every push notification
                this app sends — budget alerts, a new shared expense,
                and settle-up confirmations — not just budgets. Kept
                the original storage key (bs.budgets.alertsEnabled) to
                avoid a migration; only the label changed. */}
            <View style={{ flex: 1, marginRight: theme.spacing.sm }}>
              <Text style={styles.alertLabel}>{t('notifications')}</Text>
              <Text style={styles.inviteHint}>{t('budgetAlertsSharedExpensesSettle')}</Text>
            </View>
            <Switch
              value={budgetAlertsEnabled}
              onValueChange={toggleBudgetAlerts}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              thumbColor="#FFFFFF"
              style={styles.budgetAlertsSwitch}
            />
          </View>
        </Section>

        <View style={{ marginBottom: theme.spacing.sm }}>
          <Button
            label={exportingAll ? t('exporting') : t('exportAllData')}
            onPress={exportAllData}
            variant="secondary"
            loading={exportingAll}
          />
        </View>

        <View style={{ paddingTop: theme.spacing.sm }}>
          <LegalLinksRow />
        </View>

        <Pressable onPress={confirmSignOut} style={styles.signOutTextBtn} hitSlop={4}>
          <Text style={styles.signOutTextLabel}>{t('signOut2')}</Text>
        </Pressable>

        <Pressable onPress={confirmDeleteAccount} style={styles.signOutTextBtn} hitSlop={4}>
          <Text style={styles.signOutTextLabel}>{t('deleteAccount2')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Formats a converted budget amount for display in the numeric input —
 * whole numbers for INR (no minor unit in everyday use), 2 decimals
 * otherwise. Only used to seed the field; the user's own typing is left
 * untouched by updateCategoryBudget. */
function formatBudgetInput(amount: number, currency: CurrencyCode): string {
  if (amount === 0) return '';
  const decimals = currencyDecimals(currency);
  return amount.toFixed(decimals);
}

function Section({
  title,
  children,
  onLayout,
  onCardLayout,
}: {
  title: string;
  children: React.ReactNode;
  onLayout?: (e: LayoutChangeEvent) => void;
  onCardLayout?: (e: LayoutChangeEvent) => void;
}) {
  const styles = useSettingsStyles();
  return (
    <View style={styles.section} onLayout={onLayout}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card} onLayout={onCardLayout}>
        {children}
      </View>
    </View>
  );
}
