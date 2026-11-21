import { describe, expect, it } from 'vitest';
import { convertEntryToUsd } from '@app/lib/currency';
import { buildIncomePayload, roundUsd, validateIncome } from '../incomeWrite';

describe('validateIncome', () => {
  it('requires a source, a positive amount, and who earned it', () => {
    expect(validateIncome('', 10, 'u1')).toBe('Enter where the money came from.');
    expect(validateIncome('  ', 10, 'u1')).toBe('Enter where the money came from.');
    expect(validateIncome('Pay', 0, 'u1')).toBe('Enter an amount greater than zero.');
    expect(validateIncome('Pay', -1, 'u1')).toBe('Enter an amount greater than zero.');
    expect(validateIncome('Pay', 10, '')).toBe('Choose who earned it.');
    expect(validateIncome('Pay', 10, 'u1')).toBeNull();
  });
});

describe('buildIncomePayload', () => {
  const base = {
    source: '  Acme  ',
    date: '2026-03-15',
    amount: 138,
    currency: 'CAD' as const,
    category: 'Salary' as const,
    earnedBy: 'u1',
    notes: '  bonus  ',
    createdBy: 'u1',
    now: '2026-11-21T12:00:00.000Z',
    repeating: { enabled: false, frequency: 'monthly' as const, months: '12' },
  };

  it('stores CAD as USD-canonical, keeps a civil date (not noon ISO), and trims notes', () => {
    const doc = buildIncomePayload({ ...base, isNew: true });
    expect(doc.date).toBe('2026-03-15');
    expect(doc.date).not.toMatch(/T/);
    expect(doc.amountUsd).toBe(roundUsd(convertEntryToUsd(138, 'CAD')));
    expect(doc.sourceName).toBe('Acme');
    expect(doc.notes).toBe('bonus');
    expect(doc.originalCurrency).toBe('CAD');
    expect(doc.recurring).toBeNull();
    expect(doc.isRecurringOccurrence).toBe(false);
    expect(doc.createdBy).toBe('u1');
    expect(doc.createdAt).toBe(base.now);
    expect(doc.updatedAt).toBe(base.now);
  });

  it('does not reset createdAt when editing, and blanks notes become null', () => {
    const doc = buildIncomePayload({ ...base, isNew: false, notes: '   ' });
    expect(doc.createdAt).toBeUndefined();
    expect(doc.createdBy).toBeUndefined();
    expect(doc.isRecurringOccurrence).toBeUndefined();
    expect(doc.notes).toBeNull();
    expect(doc.updatedAt).toBe(base.now);
  });

  it('seeds a recurring schedule from the civil date', () => {
    const doc = buildIncomePayload({
      ...base,
      isNew: true,
      repeating: { enabled: true, frequency: 'monthly', months: '6' },
    });
    expect(doc.recurring).toEqual({ frequency: 'monthly', nextDueDate: '2026-04-15', endDate: '2026-09-15' });
  });
});
