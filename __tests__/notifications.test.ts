const mockSetNotificationHandler = jest.fn();
const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockGetExpoPushTokenAsync = jest.fn();
const mockScheduleNotificationAsync = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationHandler: (...args: unknown[]) => mockSetNotificationHandler(...args),
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  getExpoPushTokenAsync: (...args: unknown[]) => mockGetExpoPushTokenAsync(...args),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'proj-1' } } },
}));

const mockGetBudgetAlertsEnabled = jest.fn();
const mockGetCategoryBudgets = jest.fn();
const mockGetLastBudgetAlertDate = jest.fn();
const mockSetLastBudgetAlertDate = jest.fn();

jest.mock('../lib/secureStorage', () => ({
  getBudgetAlertsEnabled: (...args: unknown[]) => mockGetBudgetAlertsEnabled(...args),
  getCategoryBudgets: (...args: unknown[]) => mockGetCategoryBudgets(...args),
  getLastBudgetAlertDate: (...args: unknown[]) => mockGetLastBudgetAlertDate(...args),
  setLastBudgetAlertDate: (...args: unknown[]) => mockSetLastBudgetAlertDate(...args),
}));

const mockGetCurrentHouseholdId = jest.fn();
const mockGetReceiptsByMonth = jest.fn();

jest.mock('../lib/database', () => ({
  getCurrentHouseholdId: (...args: unknown[]) => mockGetCurrentHouseholdId(...args),
  getReceiptsByMonth: (...args: unknown[]) => mockGetReceiptsByMonth(...args),
}));

const mockGetHouseholdMemberPushTokens = jest.fn();
const mockGetHouseholdMembers = jest.fn();
const mockGetPushTokensForUids = jest.fn();

jest.mock('../lib/cloudSync', () => ({
  getHouseholdMemberPushTokens: (...args: unknown[]) => mockGetHouseholdMemberPushTokens(...args),
  getHouseholdMembers: (...args: unknown[]) => mockGetHouseholdMembers(...args),
  getPushTokensForUids: (...args: unknown[]) => mockGetPushTokensForUids(...args),
}));

import {
  getNotificationPermissionGranted,
  requestNotificationPermission,
  registerForPushNotificationsAsync,
  sendExpoPushNotifications,
  checkBudgetsAndNotify,
  notifyHouseholdOfBudgetStatus,
  notifyNewExpenseToHousehold,
  notifyNewSharedExpense,
  notifySettleUp,
} from '../lib/notifications';
import { Receipt } from '../types';

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('getNotificationPermissionGranted', () => {
  it('true when status is granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
    expect(await getNotificationPermissionGranted()).toBe(true);
  });

  it('false otherwise', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });
    expect(await getNotificationPermissionGranted()).toBe(false);
  });
});

describe('requestNotificationPermission', () => {
  it('short-circuits without re-prompting when already granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const result = await requestNotificationPermission();
    expect(result).toBe(true);
    expect(mockRequestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('prompts and returns the new status when not already granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    const result = await requestNotificationPermission();
    expect(result).toBe(true);
    expect(mockRequestPermissionsAsync).toHaveBeenCalled();
  });
});

describe('registerForPushNotificationsAsync', () => {
  it('returns null when permission is not granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });
    expect(await registerForPushNotificationsAsync()).toBeNull();
    expect(mockGetExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('returns the token when permission is granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    const result = await registerForPushNotificationsAsync();
    expect(result).toBe('ExponentPushToken[abc]');
    expect(mockGetExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
  });

  it('returns null when getExpoPushTokenAsync throws', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetExpoPushTokenAsync.mockRejectedValue(new Error('no native module'));
    expect(await registerForPushNotificationsAsync()).toBeNull();
  });
});

describe('sendExpoPushNotifications', () => {
  it('no-ops on an empty token list', async () => {
    await sendExpoPushNotifications([], 'Title', 'Body');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('dedupes tokens via Set before sending', async () => {
    await sendExpoPushNotifications(['t1', 't1', 't2'], 'Title', 'Body');
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.map((m: { to: string }) => m.to).sort()).toEqual(['t1', 't2']);
  });

  it('never throws on fetch failure', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('network down'));
    await expect(sendExpoPushNotifications(['t1'], 'Title', 'Body')).resolves.toBeUndefined();
  });
});

// ─── budget status logic ────────────────────────────────────────────────

const receipt = (overrides: Partial<Receipt>): Receipt => ({
  id: 'r1',
  storeName: 'X',
  date: '2026-08-01',
  totalAmount: 0,
  category: 'Groceries',
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

describe('checkBudgetsAndNotify', () => {
  beforeEach(() => {
    mockGetCurrentHouseholdId.mockReturnValue('h1');
    mockGetBudgetAlertsEnabled.mockResolvedValue(true);
    mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetLastBudgetAlertDate.mockResolvedValue(null);
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 100 });
    mockGetReceiptsByMonth.mockResolvedValue([]);
  });

  it('no-ops when there is no current household', async () => {
    mockGetCurrentHouseholdId.mockReturnValue(null);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('no-ops when alerts are disabled', async () => {
    mockGetBudgetAlertsEnabled.mockResolvedValue(false);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('no-ops when permission is not granted', async () => {
    mockGetPermissionsAsync.mockResolvedValue({ status: 'denied' });
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('no-ops when already alerted today', async () => {
    mockGetLastBudgetAlertDate.mockResolvedValue(new Date().toISOString().slice(0, 10));
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('no-ops when spend is under every threshold', async () => {
    mockGetReceiptsByMonth.mockResolvedValue([receipt({ totalAmount: 50, category: 'Groceries' })]);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('fires a "Nearing budget" notification at the watch threshold (>70%)', async () => {
    mockGetReceiptsByMonth.mockResolvedValue([receipt({ totalAmount: 75, category: 'Groceries' })]);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: 'Nearing budget',
          body: expect.stringContaining('Groceries'),
        }),
      }),
    );
    expect(mockSetLastBudgetAlertDate).toHaveBeenCalledWith('h1', expect.any(String));
  });

  it('fires an "Over budget" notification past the over threshold (>90%)', async () => {
    mockGetReceiptsByMonth.mockResolvedValue([receipt({ totalAmount: 95, category: 'Groceries' })]);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: 'Over budget',
          body: expect.stringContaining('Over: Groceries'),
        }),
      }),
    );
  });

  it('alerts for a custom category whose budget is exceeded', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Subscriptions: 200 });
    mockGetReceiptsByMonth.mockResolvedValue([
      receipt({ id: 'c1', totalAmount: 120, category: 'Subscriptions' }),
      receipt({ id: 'c2', totalAmount: 90, category: 'Subscriptions' }),
    ]);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: 'Over budget',
          body: expect.stringContaining('Over: Subscriptions'),
        }),
      }),
    );
  });

  it('alerts when line-item categories push a budget over, even if the receipt category differs', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Subscriptions: 100 });
    mockGetReceiptsByMonth.mockResolvedValue([
      receipt({
        totalAmount: 100,
        category: 'Groceries',
        lineItems: [{ id: 'i1', name: 'Streaming', amount: 100, category: 'Subscriptions' }],
      }),
    ]);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ body: expect.stringContaining('Over: Subscriptions') }),
      }),
    );
  });

  it('a custom category under its limit does not alert', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Subscriptions: 200 });
    mockGetReceiptsByMonth.mockResolvedValue([receipt({ totalAmount: 50, category: 'Subscriptions' })]);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('joins multiple over categories and lists watch categories separately', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 100, Gas: 100, Dining: 100 });
    mockGetReceiptsByMonth.mockResolvedValue([
      receipt({ id: 'a', totalAmount: 95, category: 'Groceries' }),
      receipt({ id: 'b', totalAmount: 95, category: 'Gas' }),
      receipt({ id: 'c', totalAmount: 75, category: 'Dining' }),
    ]);
    await checkBudgetsAndNotify();
    const call = mockScheduleNotificationAsync.mock.calls[0][0];
    expect(call.content.title).toBe('Over budget');
    expect(call.content.body).toContain('Over: Groceries, Gas');
    expect(call.content.body).toContain('Nearing limit: Dining');
  });

  it('adds recurring-flagged receipt spend to the RECURRING_BUDGET_KEY bucket', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Recurring: 100 });
    mockGetReceiptsByMonth.mockResolvedValue([
      receipt({
        totalAmount: 95,
        category: 'Groceries',
        isRecurringOccurrence: true,
      }),
    ]);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ body: expect.stringContaining('Recurring') }),
      }),
    );
  });

  it('does not double-add a receipt whose own category is literally "Recurring"', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Recurring: 100 });
    mockGetReceiptsByMonth.mockResolvedValue([
      receipt({
        totalAmount: 50,
        category: 'Recurring',
        recurring: { frequency: 'monthly', nextDueDate: '2026-09-01', endDate: '2027-01-01' },
      }),
    ]);
    await checkBudgetsAndNotify();
    // 50/100 = 50% => under watch threshold, so no notification should fire
    // if double-counted it would be 100/100 = over.
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('a 0-limit category is ignored even when there is spend', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 0, Dining: 100 });
    mockGetReceiptsByMonth.mockResolvedValue([
      receipt({ id: 'g', totalAmount: 500, category: 'Groceries' }),
      receipt({ id: 'd', totalAmount: 10, category: 'Dining' }),
    ]);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('overlapping calls for the same household fire only one notification', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockGetBudgetAlertsEnabled.mockReturnValue(gate.then(() => true));
    mockGetReceiptsByMonth.mockResolvedValue([receipt({ totalAmount: 95, category: 'Groceries' })]);

    const first = checkBudgetsAndNotify();
    const second = checkBudgetsAndNotify();
    release();
    await Promise.all([first, second]);

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockSetLastBudgetAlertDate).toHaveBeenCalledTimes(1);
  });
});

describe('notifyHouseholdOfBudgetStatus', () => {
  it('no-ops when householdId is null', async () => {
    await notifyHouseholdOfBudgetStatus({ householdId: null, selfUid: 'u1', monthReceipts: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('no-ops when alerts are disabled', async () => {
    mockGetBudgetAlertsEnabled.mockResolvedValue(false);
    await notifyHouseholdOfBudgetStatus({ householdId: 'h1', selfUid: 'u1', monthReceipts: [] });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends a push to household member tokens when over budget', async () => {
    mockGetBudgetAlertsEnabled.mockResolvedValue(true);
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 100 });
    mockGetHouseholdMemberPushTokens.mockResolvedValue(['tokenA']);
    await notifyHouseholdOfBudgetStatus({
      householdId: 'h1',
      selfUid: 'u1',
      monthReceipts: [receipt({ totalAmount: 95, category: 'Groceries' })],
    });
    expect(mockGetHouseholdMemberPushTokens).toHaveBeenCalledWith('h1', 'u1');
    expect(global.fetch).toHaveBeenCalled();
  });
});

describe('notifyNewExpenseToHousehold', () => {
  it('excludes self and explicit excludeUids from recipients', async () => {
    mockGetHouseholdMembers.mockResolvedValue([
      { uid: 'u1', email: null, displayName: 'Me', role: 'owner', isYou: true },
      { uid: 'u2', email: null, displayName: 'Bob', role: 'member', isYou: false },
      { uid: 'u3', email: null, displayName: 'Carol', role: 'member', isYou: false },
    ]);
    mockGetPushTokensForUids.mockResolvedValue(['t2']);
    await notifyNewExpenseToHousehold({
      householdId: 'h1',
      selfUid: 'u1',
      excludeUids: ['u3'],
      payerLabel: 'Alice',
      amountLabel: '$10',
      storeName: 'Store',
    });
    expect(mockGetPushTokensForUids).toHaveBeenCalledWith(['u2']);
  });

  it('no-ops if nobody is left after exclusions', async () => {
    mockGetHouseholdMembers.mockResolvedValue([
      { uid: 'u1', email: null, displayName: 'Me', role: 'owner', isYou: true },
    ]);
    await notifyNewExpenseToHousehold({
      householdId: 'h1',
      selfUid: 'u1',
      payerLabel: 'Alice',
      amountLabel: '$10',
      storeName: 'Store',
    });
    expect(mockGetPushTokensForUids).not.toHaveBeenCalled();
  });

  it('no-ops when members lookup returns null', async () => {
    mockGetHouseholdMembers.mockResolvedValue(null);
    await notifyNewExpenseToHousehold({
      householdId: 'h1',
      selfUid: 'u1',
      payerLabel: 'Alice',
      amountLabel: '$10',
      storeName: 'Store',
    });
    expect(mockGetPushTokensForUids).not.toHaveBeenCalled();
  });
});

describe('notifyNewSharedExpense', () => {
  it('no-ops on empty participants', async () => {
    await notifyNewSharedExpense({
      participantUids: [],
      payerLabel: 'Alice',
      amountLabel: '$10',
      storeName: 'Store',
    });
    expect(mockGetPushTokensForUids).not.toHaveBeenCalled();
  });

  it('sends a push to the given participants', async () => {
    mockGetPushTokensForUids.mockResolvedValue(['t1']);
    await notifyNewSharedExpense({
      participantUids: ['u2'],
      payerLabel: 'Alice',
      amountLabel: '$10',
      storeName: 'Store',
    });
    expect(mockGetPushTokensForUids).toHaveBeenCalledWith(['u2']);
    expect(global.fetch).toHaveBeenCalled();
  });
});

describe('notifySettleUp', () => {
  beforeEach(() => {
    mockGetPushTokensForUids.mockResolvedValue(['t1']);
  });

  it('body reflects the actor having paid when actorIsPayer is true', async () => {
    await notifySettleUp({ toUid: 'u2', actorLabel: 'Alice', amountLabel: '$10', actorIsPayer: true });
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body[0].body).toBe('Alice paid you $10');
  });

  it('body reflects marking as received when actorIsPayer is false', async () => {
    await notifySettleUp({ toUid: 'u2', actorLabel: 'Alice', amountLabel: '$10', actorIsPayer: false });
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body[0].body).toBe('Alice marked $10 as received from you');
  });
});
