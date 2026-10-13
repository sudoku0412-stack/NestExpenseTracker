import { describe, expect, it } from 'vitest';
import { convertEntryToUsd } from '@app/lib/currency';
import { buildIncomeWrite, validateIncomeDraft } from '../incomeDraft';

describe('validateIncomeDraft', () => {
  it('requires a source, a positive amount, and who earned it', () => {
    expect(validateIncomeDraft({ source: '  ', amount: '100', earnedBy: 'u1' })).toBe('Enter where the money came from.');
    expect(validateIncomeDraft({ source: 'Payroll', amount: '0', earnedBy: 'u1' })).toBe('Enter an amount greater than zero.');
    expect(validateIncomeDraft({ source: 'Payroll', amount: '100', earnedBy: '' })).toBe('Choose who earned it.');
    expect(validateIncomeDraft({ source: 'Payroll', amount: '100', earnedBy: 'u1' })).toBeNull();
  });
});

describe('buildIncomeWrite', () => {
  const base = {
    source: '  Acme  ',
    date: '2026-03-01',
    amount: '1380',
    category: 'Salary' as const,
    earnedBy: 'u2',
    notes: '  March  ',
    currency: 'CAD' as const,
    repeat: { enabled: true, frequency: 'monthly' as const, months: '12' },
    now: '2026-03-01T12:00:00.000Z',
    createdBy: 'u1',
    isNew: true,
  };

  it('keeps the civil date string, converts CAD to USD, and stamps createdBy only on insert', () => {
    const created = buildIncomeWrite(base);
    expect(created.sourceName).toBe('Acme');
    expect(created.date).toBe('2026-03-01');
    expect(created.amountUsd).toBe(Math.round(convertEntryToUsd(1380, 'CAD') * 100) / 100);
    expect(created.originalCurrency).toBe('CAD');
    expect(created.createdBy).toBe('u1');
    expect(created.isRecurringOccurrence).toBe(false);
    expect(created.recurring).toEqual({ frequency: 'monthly', nextDueDate: '2026-04-01', endDate: '2027-03-01' });
    const edited = buildIncomeWrite({ ...base, isNew: false, notes: '  ', repeat: { enabled: false, frequency: 'monthly', months: '' } });
    expect(edited.createdBy).toBeUndefined();
    expect(edited.createdAt).toBeUndefined();
    expect(edited.notes).toBeNull();
    expect(edited.recurring).toBeNull();
    expect(edited.updatedAt).toBe(base.now);
  });
});
