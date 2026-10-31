const mockGetPermissionsAsync = jest.fn();
const mockScheduleNotificationAsync = jest.fn();

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: (...args: unknown[]) => mockGetPermissionsAsync(...args),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
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

import { checkBudgetsAndNotify, notifyHouseholdOfBudgetStatus } from '../lib/notifications';
import { Receipt } from '../types';

const originalFetch = global.fetch;

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

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  mockGetCurrentHouseholdId.mockReturnValue('h1');
  mockGetBudgetAlertsEnabled.mockResolvedValue(true);
  mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockGetLastBudgetAlertDate.mockResolvedValue(null);
  mockGetCategoryBudgets.mockResolvedValue({ Groceries: 100 });
  mockGetReceiptsByMonth.mockResolvedValue([]);
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('budget alert thresholds (70% watch / 90% over)', () => {
  it('does not fire at exactly 70% (watch is strictly greater than 0.7)', async () => {
    mockGetReceiptsByMonth.mockResolvedValue([receipt({ totalAmount: 70, category: 'Groceries' })]);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockSetLastBudgetAlertDate).not.toHaveBeenCalled();
  });

  it('fires Nearing at exactly 90% (over is strictly greater than 0.9)', async () => {
    mockGetReceiptsByMonth.mockResolvedValue([receipt({ totalAmount: 90, category: 'Groceries' })]);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ title: 'Nearing budget' }),
      }),
    );
  });

  it('fires Over just past 90%', async () => {
    mockGetReceiptsByMonth.mockResolvedValue([receipt({ totalAmount: 90.01, category: 'Groceries' })]);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ title: 'Over budget' }),
      }),
    );
  });

  it('a zero or negative limit is ignored even when spend is large', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 0, Dining: -40 });
    mockGetReceiptsByMonth.mockResolvedValue([
      receipt({ id: 'g', totalAmount: 400, category: 'Groceries' }),
      receipt({ id: 'd', totalAmount: 80, category: 'Dining' }),
    ]);
    await checkBudgetsAndNotify();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('notifyHouseholdOfBudgetStatus threshold gate', () => {
  it('does not push household members when spend is still on-track', async () => {
    mockGetHouseholdMemberPushTokens.mockResolvedValue(['tokenA']);
    await notifyHouseholdOfBudgetStatus({
      householdId: 'h1',
      selfUid: 'u1',
      monthReceipts: [receipt({ totalAmount: 70, category: 'Groceries' })],
    });
    expect(mockGetHouseholdMemberPushTokens).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not push when every configured limit is 0', async () => {
    mockGetCategoryBudgets.mockResolvedValue({ Groceries: 0, Gas: 0 });
    await notifyHouseholdOfBudgetStatus({
      householdId: 'h1',
      selfUid: 'u1',
      monthReceipts: [receipt({ totalAmount: 500, category: 'Groceries' })],
    });
    expect(mockGetHouseholdMemberPushTokens).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
