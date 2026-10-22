import { formatLocalDate } from './calendarDate';
import { categoryLabel } from './categoryLabel';
import { tr } from './i18n';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Receipt } from '../types';
import {
  getBudgetAlertsEnabled,
  getCategoryBudgets,
  getLastBudgetAlertDate,
  setLastBudgetAlertDate,
} from './secureStorage';
import { getCurrentHouseholdId, getReceiptsByMonth } from './database';
import { getHouseholdMemberPushTokens, getHouseholdMembers, getPushTokensForUids } from './cloudSync';
import { computeBudgetSpend } from './budgetSpend';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function getNotificationPermissionGranted(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted';
}

/** Ask the OS for notification permission. Returns whether it's granted
 *  after the prompt (or already was). Only call this from an explicit
 *  user action (e.g. turning the Settings toggle on) — never silently
 *  on app launch. */
export async function requestNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

// ─── remote push (household activity: over-budget, shared expenses,
// settle-up — anything that happens on ANOTHER member's device and
// should reach this one even while the app isn't open) ─────────────────
//
// No backend in this app — Expo's push service (https://exp.host) takes
// a push token and sends it on to APNs/FCM with no server-side auth
// needed, so the device that CAUSES an event can call it directly,
// fire-and-forget, same pattern as every other cloud write here.

/**
 * Registers this device for push and returns its Expo push token, or
 * null if permission isn't granted or the native module isn't linked
 * yet (needs a fresh build — expo-notifications was only just added to
 * app.config.js's plugins list, see HANDOVER.md-style native-dep
 * caveats elsewhere in this codebase). Safe to call repeatedly; the
 * token is stable per install unless the app is reinstalled.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  const granted = await getNotificationPermissionGranted();
  if (!granted) return null;
  try {
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[notifications] registerForPushNotificationsAsync failed:', (e as Error)?.message);
    return null;
  }
}

/** Fire-and-forget push send via Expo's hosted push service — no
 *  server-side credentials needed, just the recipient's token. Errors
 *  are logged, never thrown; a failed push is never worth blocking or
 *  surfacing to the user who triggered the underlying action. */
export async function sendExpoPushNotifications(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const uniqueTokens = Array.from(new Set(tokens)).filter(Boolean);
  if (uniqueTokens.length === 0) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        uniqueTokens.map((to) => ({ to, title, body, data, sound: 'default' })),
      ),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[notifications] sendExpoPushNotifications failed:', (e as Error)?.message);
  }
}

const BUDGET_STATUS_THRESHOLDS = { watch: 0.7, over: 0.9 };

function statusFor(spent: number, limit: number): 'onTrack' | 'watch' | 'over' {
  if (limit <= 0) return 'onTrack';
  const pct = spent / limit;
  if (pct > BUDGET_STATUS_THRESHOLDS.over) return 'over';
  if (pct > BUDGET_STATUS_THRESHOLDS.watch) return 'watch';
  return 'onTrack';
}

function todayYmd(): string {
  return formatLocalDate(new Date());
}

/** Guards checkBudgetsAndNotify against concurrent overlapping calls
 *  (e.g. useFocusEffect firing more than once in quick succession) —
 *  without this, each concurrent call reads the same stale
 *  lastBudgetAlertDate before any of them writes the updated value,
 *  so all of them pass the once-per-day throttle and each fires its
 *  own notification. A synchronous Set check-and-add has no await in
 *  between, so it can't race the way the storage read/write can. */
const budgetCheckInFlight = new Set<string>();

/** Shared by checkBudgetsAndNotify (self, polled) and
 *  notifyHouseholdOfBudgetStatus (whole household, event-driven) —
 *  categorizes this month's spend against each category's limit and
 *  builds the one-notification-total summary, or null if nothing's
 *  over/nearing. `receipts` should already be month-scoped. */
function computeBudgetStatusSummary(
  receipts: Receipt[],
  budgets: Record<string, number>,
): { title: string; body: string } | null {
  const categoriesWithBudgets = Object.entries(budgets).filter(([, limit]) => limit > 0);
  if (categoriesWithBudgets.length === 0) return null;

  const spentByCategory = computeBudgetSpend(receipts);

  const over: string[] = [];
  const watch: string[] = [];
  for (const [category, limit] of categoriesWithBudgets) {
    const spent = spentByCategory[category] ?? 0;
    const status = statusFor(spent, limit);
    if (status === 'over') over.push(category);
    else if (status === 'watch') watch.push(category);
  }
  if (over.length === 0 && watch.length === 0) return null;

  const title = over.length > 0 ? tr('overBudget') : tr('nearingBudget');
  const parts: string[] = [];
  if (over.length > 0) parts.push(tr('overList', { list: over.map(categoryLabel).join(', ') }));
  if (watch.length > 0) parts.push(tr('nearingLimitList', { list: watch.map(categoryLabel).join(', ') }));
  return { title, body: parts.join(' · ') };
}

/**
 * Check this month's spend against each category's budget limit and
 * fire ONE local notification summarizing whichever categories are
 * "over" or "watch" — never one notification per category. Does
 * nothing (silently) unless BOTH the in-app "Budget alerts" toggle is
 * on AND the OS notification permission is actually granted; the
 * toggle alone was previously a no-op with nothing wired to it.
 *
 * Safe to call on every app foreground — throttled to at most once
 * per calendar day via lib/secureStorage's lastBudgetAlertDate, so
 * calling it repeatedly (e.g. every time Home gains focus) doesn't
 * spam the user.
 */
export async function checkBudgetsAndNotify(): Promise<void> {
  const householdId = getCurrentHouseholdId();
  if (!householdId) return;
  if (budgetCheckInFlight.has(householdId)) return;
  budgetCheckInFlight.add(householdId);
  try {
    const [alertsEnabled, permissionGranted, lastAlertDate] = await Promise.all([
      getBudgetAlertsEnabled(householdId),
      getNotificationPermissionGranted(),
      getLastBudgetAlertDate(householdId),
    ]);
    if (!alertsEnabled || !permissionGranted) return;
    if (lastAlertDate === todayYmd()) return;

    const budgets = await getCategoryBudgets(householdId);
    const now = new Date();
    const receipts = await getReceiptsByMonth(now.getFullYear(), now.getMonth() + 1);
    const summary = computeBudgetStatusSummary(receipts, budgets);
    if (!summary) return;

    await Notifications.scheduleNotificationAsync({
      content: { title: summary.title, body: summary.body },
      trigger: null, // fire immediately
    });
    await setLastBudgetAlertDate(householdId, todayYmd());
  } finally {
    budgetCheckInFlight.delete(householdId);
  }
}

/**
 * Event-driven counterpart to checkBudgetsAndNotify, called right
 * after a receipt save/edit — pushes every OTHER household member
 * immediately (their own device may not open the app for hours) when
 * the shared category spend just crossed into watch/over. Since
 * budgets are now synced household-wide (lib/AuthContext.tsx's
 * subscribeToHouseholdBudgets), the limit being checked is the same
 * one every member sees. Self isn't pushed here — whoever just saved
 * the receipt is already looking at the app.
 */
export async function notifyHouseholdOfBudgetStatus(args: {
  householdId: string | null;
  selfUid: string;
  monthReceipts: Receipt[];
}): Promise<void> {
  if (!args.householdId) return;
  const alertsEnabled = await getBudgetAlertsEnabled(args.householdId);
  if (!alertsEnabled) return;
  const budgets = await getCategoryBudgets(args.householdId);
  const summary = computeBudgetStatusSummary(args.monthReceipts, budgets);
  if (!summary) return;
  const tokens = await getHouseholdMemberPushTokens(args.householdId, args.selfUid);
  await sendExpoPushNotifications(tokens, summary.title, summary.body);
}

/**
 * Pushes every OTHER household member — except whoever's already
 * getting the more specific "split with you" push via
 * notifyNewSharedExpense below — whenever any member adds a new
 * expense. Split participants get told exactly what they owe/are
 * involved in; everyone else just hears that *an* expense was added,
 * so nobody is silently left out of household activity, but nobody
 * gets pinged twice for the same receipt either.
 */
export async function notifyNewExpenseToHousehold(args: {
  householdId: string;
  selfUid: string;
  /** Uids already notified via notifyNewSharedExpense for this same
   *  receipt — excluded here to avoid a duplicate push. */
  excludeUids?: string[];
  payerLabel: string;
  amountLabel: string;
  storeName: string;
}): Promise<void> {
  const members = await getHouseholdMembers({ householdId: args.householdId, currentUid: args.selfUid });
  if (!members) return;
  const exclude = new Set([args.selfUid, ...(args.excludeUids ?? [])]);
  const targetUids = members.map((m) => m.uid).filter((uid) => !exclude.has(uid));
  if (targetUids.length === 0) return;
  const tokens = await getPushTokensForUids(targetUids);
  await sendExpoPushNotifications(
    tokens,
    'New expense',
    `${args.payerLabel} added ${args.amountLabel} at ${args.storeName}`,
  );
}

/** Pushes each OTHER participant of a newly-saved/edited split expense
 *  — the "anything" beyond budgets: someone should hear about a new
 *  shared cost immediately, not just next time they open Balances. */
export async function notifyNewSharedExpense(args: {
  participantUids: string[];
  payerLabel: string;
  amountLabel: string;
  storeName: string;
}): Promise<void> {
  if (args.participantUids.length === 0) return;
  const tokens = await getPushTokensForUids(args.participantUids);
  await sendExpoPushNotifications(
    tokens,
    'New shared expense',
    `${args.payerLabel} added ${args.amountLabel} at ${args.storeName}, split with you`,
    { screen: 'home' },
  );
}

/** Pushes the other side of a "settle up" — whoever DIDN'T tap the
 *  button should know their balance with that person just changed.
 *  `actorIsPayer`: true when the person tapping was the one who OWED
 *  and just paid; false when they were owed and just confirmed
 *  receiving payment on the other person's behalf. */
export async function notifySettleUp(args: {
  toUid: string;
  actorLabel: string;
  amountLabel: string;
  actorIsPayer: boolean;
}): Promise<void> {
  const tokens = await getPushTokensForUids([args.toUid]);
  const body = args.actorIsPayer
    ? `${args.actorLabel} paid you ${args.amountLabel}`
    : `${args.actorLabel} marked ${args.amountLabel} as received from you`;
  await sendExpoPushNotifications(tokens, 'Settled up', body, { screen: 'home' });
}
