/**
 * Firestore rejects a whole document if any nested field is `undefined`.
 * Receipts already strip that (equal-split `values`). Incomes/goals/
 * investments used a shallow `?? null` and could still send nested
 * undefined (e.g. a recurring template with no endDate).
 */

jest.mock('@react-native-firebase/firestore', () => ({
  default: Object.assign(() => ({}), {
    FieldValue: { serverTimestamp: () => ({ __op: 'serverTimestamp' }) },
  }),
}));

jest.mock('@react-native-firebase/storage', () => ({
  default: () => ({}),
}));

jest.mock('../../lib/secureStorage', () => ({
  applyBudgetsSnapshot: jest.fn(),
  getCloudMigrationDone: jest.fn(),
  setCloudMigrationDone: jest.fn(),
}));

jest.mock('../../lib/dataSync', () => ({
  notifyLocalDataChanged: jest.fn(),
}));

jest.mock('../../lib/database', () => ({}));

import {
  serializeIncome,
  serializeInvestmentAccount,
  serializeInvestmentSnapshot,
  serializeSavingsGoal,
} from '../../lib/cloudSync';
import type { Income, InvestmentAccount, InvestmentSnapshot, SavingsGoal } from '../../types';

const income = (o: Partial<Income> = {}): Income => ({
  id: 'inc-1',
  sourceName: 'Payroll',
  date: '2026-03-15',
  amountUsd: 1200,
  category: 'Salary',
  earnedBy: 'u1',
  createdAt: '2026-03-15T00:00:00.000Z',
  updatedAt: '2026-03-15T00:00:00.000Z',
  ...o,
});

describe('serializeIncome', () => {
  it('turns omitted notes/currency/createdBy into null, not undefined', () => {
    const payload = serializeIncome(income());
    expect(payload.notes).toBeNull();
    expect(payload.originalCurrency).toBeNull();
    expect(payload.createdBy).toBeNull();
    expect(payload.recurring).toBeNull();
    expect(payload.isRecurringOccurrence).toBe(false);
    expect(Object.values(payload).some((v) => v === undefined)).toBe(false);
  });

  it('passes a fully specified recurring schedule through unchanged', () => {
    const payload = serializeIncome(
      income({
        notes: 'net',
        originalCurrency: 'CAD',
        createdBy: 'u1',
        isRecurringOccurrence: true,
        recurring: {
          frequency: 'monthly',
          nextDueDate: '2026-04-15',
          endDate: '2027-01-01',
        },
      }),
    );
    expect(payload).toMatchObject({
      notes: 'net',
      originalCurrency: 'CAD',
      createdBy: 'u1',
      isRecurringOccurrence: true,
      recurring: {
        frequency: 'monthly',
        nextDueDate: '2026-04-15',
        endDate: '2027-01-01',
      },
    });
  });
});

describe('serializeSavingsGoal', () => {
  it('writes notes as null when omitted', () => {
    const goal: SavingsGoal = {
      id: 'g1',
      name: 'Vacation',
      targetUsd: 2000,
      allocatedUsd: 50,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(serializeSavingsGoal(goal)).toEqual({
      name: 'Vacation',
      targetUsd: 2000,
      allocatedUsd: 50,
      notes: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('serializeInvestmentAccount / snapshot', () => {
  it('omitted account notes become null', () => {
    const account: InvestmentAccount = {
      id: 'a1',
      name: 'TFSA',
      kind: 'stocks',
      contributedUsd: 1000,
      valueUsd: 1100,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    };
    expect(serializeInvestmentAccount(account).notes).toBeNull();
    expect(Object.values(serializeInvestmentAccount(account)).some((v) => v === undefined)).toBe(false);
  });

  it('snapshot payloads have no undefined fields', () => {
    const snap: InvestmentSnapshot = {
      id: 's1',
      accountId: 'a1',
      date: '2026-02-01',
      valueUsd: 1100,
      contributedUsd: 1000,
      createdAt: '2026-02-01T00:00:00.000Z',
    };
    const payload = serializeInvestmentSnapshot(snap);
    expect(payload).toEqual({
      accountId: 'a1',
      date: '2026-02-01',
      valueUsd: 1100,
      contributedUsd: 1000,
      createdAt: '2026-02-01T00:00:00.000Z',
    });
  });
});
