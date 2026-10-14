import { describe, expect, it } from 'vitest';
import { convertEntryToUsd } from '@app/lib/currency';
import { nextAllocatedUsd, parseGoalForm, parsePositiveDisplayAmount } from '../goalDraft';

describe('parseGoalForm', () => {
  it('requires a name and a target greater than zero', () => {
    expect(parseGoalForm({ name: '  ', targetText: '100', notes: '', currency: 'USD' })).toEqual({
      ok: false,
      error: 'Give the goal a name.',
    });
    expect(parseGoalForm({ name: 'Holiday', targetText: '0', notes: '', currency: 'USD' })).toEqual({
      ok: false,
      error: 'Enter a target amount greater than zero.',
    });
    expect(parseGoalForm({ name: 'Holiday', targetText: '-5', notes: '', currency: 'USD' })).toEqual({
      ok: false,
      error: 'Enter a target amount greater than zero.',
    });
  });

  it('stores a CAD target as USD and trims the name', () => {
    const out = parseGoalForm({ name: '  Holiday  ', targetText: '138', notes: 'trip', currency: 'CAD' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.name).toBe('Holiday');
    expect(out.notes).toBe('trip');
    expect(out.targetUsd).toBeCloseTo(convertEntryToUsd(138, 'CAD'), 8);
  });
});

describe('allocation adjustments', () => {
  it('ignores zero, negative, and blank take-out amounts', () => {
    expect(parsePositiveDisplayAmount(undefined)).toBeNull();
    expect(parsePositiveDisplayAmount('')).toBeNull();
    expect(parsePositiveDisplayAmount('0')).toBeNull();
    expect(parsePositiveDisplayAmount('-1')).toBeNull();
    expect(parsePositiveDisplayAmount('25.5')).toBe(25.5);
  });

  it('never lets allocatedUsd go below zero when taking out more than is saved', () => {
    expect(nextAllocatedUsd(40, convertEntryToUsd(138, 'CAD'))).toBeCloseTo(40 + 100, 8);
    expect(nextAllocatedUsd(40, -convertEntryToUsd(138, 'CAD'))).toBe(0);
    expect(nextAllocatedUsd(40, -10)).toBe(30);
  });
});
