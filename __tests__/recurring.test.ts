const mockGetAllReceipts = jest.fn();
const mockSaveReceipt = jest.fn();
const mockUpdateReceipt = jest.fn();
const mockGetAllIncomes = jest.fn();
const mockSaveIncome = jest.fn();
const mockAddToReviewQueue = jest.fn();

jest.mock('../lib/database', () => ({
  getAllReceipts: (...args: unknown[]) => mockGetAllReceipts(...args),
  saveReceipt: (...args: unknown[]) => mockSaveReceipt(...args),
  updateReceipt: (...args: unknown[]) => mockUpdateReceipt(...args),
  getAllIncomes: (...args: unknown[]) => mockGetAllIncomes(...args),
  saveIncome: (...args: unknown[]) => mockSaveIncome(...args),
  addToReviewQueue: (...args: unknown[]) => mockAddToReviewQueue(...args),
}));

import {
  isRecurringExpense,
  isRecurringIncome,
  advance,
  computeRecurringEndDate,
  processRecurringReceipts,
  processRecurringIncomes,
  resolveRecurringFromForm,
} from '../lib/recurring';
import { Income, Receipt } from '../types';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isRecurringExpense', () => {
  const base: Receipt = {
    id: 'r1',
    storeName: 'X',
    date: '2026-01-01',
    totalAmount: 10,
    category: 'Other',
    createdAt: '',
    updatedAt: '',
  };

  it('true when receipt carries an active recurring schedule', () => {
    expect(
      isRecurringExpense({
        ...base,
        recurring: { frequency: 'monthly', nextDueDate: '2026-02-01', endDate: '2027-01-01' },
      }),
    ).toBe(true);
  });

  it('true when receipt is a generated occurrence', () => {
    expect(isRecurringExpense({ ...base, isRecurringOccurrence: true })).toBe(true);
  });

  it('false for a plain one-off receipt', () => {
    expect(isRecurringExpense(base)).toBe(false);
  });
});

describe('advance', () => {
  it('advances weekly by 7 days', () => {
    expect(advance('2026-01-01', 'weekly')).toBe('2026-01-08');
  });

  it('advances monthly by one month', () => {
    expect(advance('2026-01-15', 'monthly')).toBe('2026-02-15');
  });

  it('advances yearly by one year', () => {
    expect(advance('2026-01-15', 'yearly')).toBe('2027-01-15');
  });

  it('advances biweekly by 14 days (paycheck cadence)', () => {
    expect(advance('2026-01-01', 'biweekly')).toBe('2026-01-15');
    expect(advance('2026-01-31', 'biweekly')).toBe('2026-02-14');
  });

  it('clamps month-end dates instead of overflowing into the next month', () => {
    // 2026 is not a leap year; date-fns addMonths(Jan 31) → Feb 28.
    expect(advance('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advance('2026-03-31', 'monthly')).toBe('2026-04-30');
    expect(advance('2024-02-29', 'yearly')).toBe('2025-02-28');
  });
});

describe('isRecurringIncome', () => {
  const base: Income = {
    id: 'i1',
    sourceName: 'Payroll',
    date: '2026-01-01',
    amountUsd: 1000,
    category: 'Salary',
    earnedBy: 'uid-a',
    createdAt: '',
    updatedAt: '',
  };

  it('true for a template with a schedule or a generated occurrence', () => {
    expect(
      isRecurringIncome({
        ...base,
        recurring: { frequency: 'biweekly', nextDueDate: '2026-01-15', endDate: '2026-12-31' },
      }),
    ).toBe(true);
    expect(isRecurringIncome({ ...base, isRecurringOccurrence: true })).toBe(true);
  });

  it('false for a one-off income', () => {
    expect(isRecurringIncome(base)).toBe(false);
  });
});

describe('computeRecurringEndDate', () => {
  it('adds the given number of months to the start date', () => {
    expect(computeRecurringEndDate('2026-01-15', 6)).toBe('2026-07-15');
    expect(computeRecurringEndDate('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('handles a 12-month duration (one year)', () => {
    expect(computeRecurringEndDate('2026-01-15', 12)).toBe('2027-01-15');
  });
});

describe('processRecurringReceipts', () => {
  const template = (overrides: Partial<Receipt>): Receipt => ({
    id: 'template-1',
    storeName: 'Gym',
    date: '2025-01-01',
    totalAmount: 50,
    category: 'Other',
    lineItems: [{ id: 'li1', name: 'Membership', amount: 50, category: 'Other' }],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('skips templates with no recurring field', async () => {
    mockGetAllReceipts.mockResolvedValue([template({})]);
    const created = await processRecurringReceipts();
    expect(created).toBe(0);
    expect(mockSaveReceipt).not.toHaveBeenCalled();
    expect(mockUpdateReceipt).not.toHaveBeenCalled();
  });

  it('generates occurrences for every due date between nextDueDate and today', async () => {
    // 3 weeks overdue on a weekly schedule => 3 occurrences generated
    // (today, 1 week ago, 2 weeks ago relative dates handled via fixed math).
    const t = template({
      recurring: {
        frequency: 'weekly',
        nextDueDate: '2020-01-01',
        endDate: '2030-01-01',
      },
    });
    mockGetAllReceipts.mockResolvedValue([t]);
    const created = await processRecurringReceipts();
    // Guard caps at 60; with such an old date it should hit the cap.
    expect(created).toBe(60);
    expect(mockSaveReceipt).toHaveBeenCalledTimes(60);
  });

  it('stops generating once nextDueDate passes endDate', async () => {
    const t = template({
      recurring: {
        frequency: 'monthly',
        nextDueDate: '2025-11-01',
        endDate: '2025-12-15',
      },
    });
    mockGetAllReceipts.mockResolvedValue([t]);
    const created = await processRecurringReceipts();
    // Due dates <= today (2026-08-04) AND <= endDate (2025-12-15):
    // 2025-11-01, 2025-12-01 qualify; 2026-01-01 exceeds endDate.
    expect(created).toBe(2);
    expect(mockSaveReceipt).toHaveBeenCalledTimes(2);
    const calls = mockSaveReceipt.mock.calls.map((c) => (c[0] as Receipt).date);
    expect(calls).toEqual(['2025-11-01', '2025-12-01']);
  });

  it('queues every generated occurrence for review', async () => {
    mockGetAllReceipts.mockResolvedValue([
      template({
        recurring: { frequency: 'monthly', nextDueDate: '2025-11-01', endDate: '2025-12-15' },
      }),
    ]);
    await processRecurringReceipts();
    const savedIds = mockSaveReceipt.mock.calls.map((c) => (c[0] as Receipt).id);
    expect(savedIds).toHaveLength(2);
    expect(mockAddToReviewQueue.mock.calls.map((c) => c[0])).toEqual(savedIds);
  });

  it('keeps materializing occurrences when queueing for review fails', async () => {
    mockAddToReviewQueue.mockRejectedValue(new Error('queue down'));
    mockGetAllReceipts.mockResolvedValue([
      template({
        recurring: { frequency: 'monthly', nextDueDate: '2025-11-01', endDate: '2025-12-15' },
      }),
    ]);
    const created = await processRecurringReceipts();
    expect(created).toBe(2);
    expect(mockSaveReceipt).toHaveBeenCalledTimes(2);
  });

  it('caps generated occurrences at 60 per template per call', async () => {
    const t = template({
      recurring: {
        frequency: 'weekly',
        nextDueDate: '2000-01-01',
        endDate: '2100-01-01',
      },
    });
    mockGetAllReceipts.mockResolvedValue([t]);
    const created = await processRecurringReceipts();
    expect(created).toBe(60);
  });

  it('advances nextDueDate correctly and calls updateReceipt with the schedule advanced (not the original)', async () => {
    const t = template({
      recurring: {
        frequency: 'monthly',
        nextDueDate: '2025-12-01',
        endDate: '2030-01-01',
      },
    });
    mockGetAllReceipts.mockResolvedValue([t]);
    await processRecurringReceipts();
    expect(mockUpdateReceipt).toHaveBeenCalledTimes(1);
    const updated = mockUpdateReceipt.mock.calls[0][0] as Receipt;
    // 2025-12-01 -> 2026-01-01 -> 2026-02-01 (today is 2026-08-04, so
    // it keeps advancing past 2026-08-04... wait: 2026-01-01 <= today,
    // 2026-02-01 <= today ... continues until nextDueDate > today.
    expect(updated.recurring?.nextDueDate).not.toBe('2025-12-01');
    expect(new Date(updated.recurring!.nextDueDate).getTime()).toBeGreaterThan(
      new Date(t.recurring!.nextDueDate).getTime(),
    );
    expect(updated.recurring?.endDate).toBe('2030-01-01');
  });

  it('updateReceipt call carries the template schedule forward but NOT the template line items', async () => {
    const t = template({
      recurring: { frequency: 'monthly', nextDueDate: '2025-12-01', endDate: '2030-01-01' },
    });
    mockGetAllReceipts.mockResolvedValue([t]);
    await processRecurringReceipts();
    const updated = mockUpdateReceipt.mock.calls[0][0] as Receipt;
    expect(updated.lineItems).toBeUndefined();
    expect(updated.id).toBe(t.id);
  });

  it('generated occurrences are plain clones flagged isRecurringOccurrence, with fresh ids and no recurring schedule of their own', async () => {
    const t = template({
      recurring: { frequency: 'monthly', nextDueDate: '2025-12-01', endDate: '2025-12-01' },
    });
    mockGetAllReceipts.mockResolvedValue([t]);
    await processRecurringReceipts();
    expect(mockSaveReceipt).toHaveBeenCalledTimes(1);
    const occurrence = mockSaveReceipt.mock.calls[0][0] as Receipt;
    expect(occurrence.id).not.toBe(t.id);
    expect(occurrence.isRecurringOccurrence).toBe(true);
    expect(occurrence.recurring).toBeUndefined();
    expect(occurrence.date).toBe('2025-12-01');
    expect(occurrence.lineItems?.[0].id).not.toBe(t.lineItems![0].id);
  });

  it('does not call updateReceipt when a template generates no occurrences (future nextDueDate)', async () => {
    const t = template({
      recurring: { frequency: 'monthly', nextDueDate: '2099-01-01', endDate: '2100-01-01' },
    });
    mockGetAllReceipts.mockResolvedValue([t]);
    const created = await processRecurringReceipts();
    expect(created).toBe(0);
    expect(mockSaveReceipt).not.toHaveBeenCalled();
    expect(mockUpdateReceipt).not.toHaveBeenCalled();
  });
});

describe('resolveRecurringFromForm', () => {
  it('returns undefined schedule when disabled', () => {
    const res = resolveRecurringFromForm({
      enabled: false,
      frequency: 'monthly',
      nextDueDate: '2026-04-01',
      duration: '12',
      startDate: '2026-03-01',
    });
    expect(res).toEqual({ ok: true, schedule: undefined });
  });

  it('requires duration when there is no existing end date', () => {
    const res = resolveRecurringFromForm({
      enabled: true,
      frequency: 'monthly',
      nextDueDate: '2026-04-01',
      duration: '',
      startDate: '2026-03-01',
    });
    expect(res.ok).toBe(false);
  });

  it('builds a schedule from next date and duration', () => {
    const res = resolveRecurringFromForm({
      enabled: true,
      frequency: 'monthly',
      nextDueDate: '2026-04-01',
      duration: '6',
      startDate: '2026-03-01',
    });
    expect(res).toEqual({
      ok: true,
      schedule: {
        frequency: 'monthly',
        nextDueDate: '2026-04-01',
        endDate: '2026-09-01',
      },
    });
  });

  it('rejects an invalid next auto-add date', () => {
    const res = resolveRecurringFromForm({
      enabled: true,
      frequency: 'weekly',
      nextDueDate: 'not-a-date',
      duration: '6',
      startDate: '2026-03-01',
    });
    expect(res).toEqual({ ok: false, message: 'Pick a valid next auto-add date.' });
  });

  it('rejects a non-integer duration (leading zeros / decimals)', () => {
    const leading = resolveRecurringFromForm({
      enabled: true,
      frequency: 'monthly',
      nextDueDate: '2026-04-01',
      duration: '06',
      startDate: '2026-03-01',
    });
    expect(leading.ok).toBe(false);
    const decimal = resolveRecurringFromForm({
      enabled: true,
      frequency: 'monthly',
      nextDueDate: '2026-04-01',
      duration: '6.5',
      startDate: '2026-03-01',
    });
    expect(decimal.ok).toBe(false);
  });

  it('reuses existingEndDate when duration is blank (edit path)', () => {
    const res = resolveRecurringFromForm({
      enabled: true,
      frequency: 'biweekly',
      nextDueDate: '2026-03-29',
      duration: '',
      startDate: '2026-03-15',
      existingEndDate: '2026-12-31',
    });
    expect(res).toEqual({
      ok: true,
      schedule: {
        frequency: 'biweekly',
        nextDueDate: '2026-03-29',
        endDate: '2026-12-31',
      },
    });
  });
});

describe('processRecurringIncomes', () => {
  const template = (overrides: Partial<Income>): Income => ({
    id: 'inc-template',
    sourceName: 'Acme payroll',
    date: '2025-01-01',
    amountUsd: 2000,
    category: 'Salary',
    earnedBy: 'uid-a',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('skips incomes with no recurring field', async () => {
    mockGetAllIncomes.mockResolvedValue([template({})]);
    const created = await processRecurringIncomes();
    expect(created).toBe(0);
    expect(mockSaveIncome).not.toHaveBeenCalled();
  });

  it('materializes due paychecks and advances the template', async () => {
    const t = template({
      recurring: {
        frequency: 'monthly',
        nextDueDate: '2025-11-01',
        endDate: '2025-12-15',
      },
    });
    mockGetAllIncomes.mockResolvedValue([t]);
    const created = await processRecurringIncomes();
    expect(created).toBe(2);
    expect(mockSaveIncome).toHaveBeenCalledTimes(3);
    const occurrence = mockSaveIncome.mock.calls[0][0] as Income;
    expect(occurrence.id).not.toBe(t.id);
    expect(occurrence.recurring).toBeUndefined();
    expect(occurrence.isRecurringOccurrence).toBe(true);
    expect(occurrence.date).toBe('2025-11-01');
    const updated = mockSaveIncome.mock.calls[2][0] as Income;
    expect(updated.id).toBe(t.id);
    expect(updated.recurring?.nextDueDate).toBe('2026-01-01');
  });
});
