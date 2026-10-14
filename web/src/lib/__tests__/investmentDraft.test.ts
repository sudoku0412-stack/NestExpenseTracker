import { describe, expect, it } from 'vitest';
import { convertEntryToUsd } from '@app/lib/currency';
import { parseInvestmentDialog } from '../investmentDraft';

const base = { name: 'TFSA', amountText: '', contributedText: '', notes: 'note', currency: 'USD' as const };

describe('parseInvestmentDialog', () => {
  it('requires a name on new and edit', () => {
    expect(parseInvestmentDialog('new', { ...base, name: '  ' })).toEqual({
      ok: false,
      error: 'Give the account a name.',
    });
    expect(parseInvestmentDialog('edit', { ...base, name: '' })).toEqual({
      ok: false,
      error: 'Give the account a name.',
    });
  });

  it('treats blank contributed/value on a new account as zero, converting CAD', () => {
    const out = parseInvestmentDialog('new', {
      name: '  TFSA  ',
      amountText: '138',
      contributedText: '',
      notes: 'rrsp',
      currency: 'CAD',
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.name).toBe('TFSA');
    expect(out.contributedUsd).toBe(0);
    expect(out.valueUsd).toBeCloseTo(convertEntryToUsd(138, 'CAD'), 8);
  });

  it('rejects a non-positive deposit or withdraw, but allows a value of exactly 0', () => {
    expect(parseInvestmentDialog('deposit', { ...base, amountText: '' })).toEqual({
      ok: false,
      error: 'Enter an amount greater than zero.',
    });
    expect(parseInvestmentDialog('withdraw', { ...base, amountText: '0' })).toEqual({
      ok: false,
      error: 'Enter an amount greater than zero.',
    });
    const zero = parseInvestmentDialog('value', { ...base, amountText: '0' });
    expect(zero.ok).toBe(true);
    if (zero.ok) expect(zero.valueUsd).toBe(0);
  });

  it('signs a withdrawal negative so applyContribution lowers both contributed and value', () => {
    const d = parseInvestmentDialog('deposit', { ...base, amountText: '50' });
    const w = parseInvestmentDialog('withdraw', { ...base, amountText: '50' });
    expect(d.ok && d.deltaUsd).toBe(50);
    expect(w.ok && w.deltaUsd).toBe(-50);
  });
});
