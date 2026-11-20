import { describe, expect, it } from 'vitest';
import { buildReceiptSplit, resolveParticipantIds } from '../receiptSplit';

describe('resolveParticipantIds', () => {
  it('replaces the legacy self placeholder with the signed-in uid and leaves real uids alone', () => {
    expect(resolveParticipantIds(['self', 'bob'], 'ada')).toEqual(['ada', 'bob']);
    expect(resolveParticipantIds(['ada', 'bob'], 'ada')).toEqual(['ada', 'bob']);
    expect(resolveParticipantIds(['self', 'bob'], '')).toEqual(['self', 'bob']);
  });
});

describe('buildReceiptSplit', () => {
  it('requires at least two people', () => {
    expect(buildReceiptSplit(['ada'], 'equal', {}, 10, 'USD')).toEqual({
      ok: false,
      error: 'Choose at least two people to split with.',
    });
  });

  it('stores an equal split with no values map', () => {
    expect(buildReceiptSplit(['ada', 'bob'], 'equal', {}, 30, 'USD')).toEqual({
      ok: true,
      split: { enabled: true, method: 'equal', participantIds: ['ada', 'bob'] },
    });
  });

  it('rejects percents that do not add to 100', () => {
    expect(buildReceiptSplit(['ada', 'bob'], 'percent', { ada: '40', bob: '40' }, 30, 'USD').ok).toBe(false);
  });

  it('converts amount-split values into USD and rounds to cents', () => {
    const out = buildReceiptSplit(['ada', 'bob'], 'amount', { ada: '69', bob: '69' }, 138, 'CAD');
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.split?.values).toEqual({ ada: 50, bob: 50 });
    }
  });

  it('rejects amount splits that do not add to the entry-currency total', () => {
    expect(buildReceiptSplit(['ada', 'bob'], 'amount', { ada: '10', bob: '10' }, 30, 'USD')).toEqual({
      ok: false,
      error: 'Amounts must add up to the total.',
    });
  });

  it('rejects a shares split with every share at zero', () => {
    expect(buildReceiptSplit(['ada', 'bob'], 'shares', { ada: '0', bob: '' }, 30, 'USD')).toEqual({
      ok: false,
      error: 'Give at least one person a share.',
    });
  });

  it('keeps share counts as typed (not converted to USD)', () => {
    const out = buildReceiptSplit(['ada', 'bob'], 'shares', { ada: '2', bob: '1' }, 138, 'CAD');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.split?.values).toEqual({ ada: 2, bob: 1 });
  });
});
