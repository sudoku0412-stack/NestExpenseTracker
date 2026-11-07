import { describe, expect, it } from 'vitest';
import { buildSplitPayload, lineItemsAreValid, remapSelfId, remapSelfKeyedRecord } from '../split';

describe('remapSelfId', () => {
  it('replaces the legacy self placeholder with the signed-in uid', () => {
    expect(remapSelfId('self', 'uid-a')).toBe('uid-a');
    expect(remapSelfId('uid-b', 'uid-a')).toBe('uid-b');
  });
});

describe('remapSelfKeyedRecord', () => {
  it('rewrites split.values keys so balances look up the real uid', () => {
    expect(remapSelfKeyedRecord({ self: 40, 'uid-b': 60 }, 'uid-a')).toEqual({ 'uid-a': '40', 'uid-b': '60' });
  });
});

describe('buildSplitPayload', () => {
  const people = ['uid-a', 'uid-b'];

  it('writes null when splitting is off', () => {
    expect(buildSplitPayload({ enabled: false, method: 'equal', people, vals: {}, totalInEntryCurrency: 10, currency: 'USD' })).toEqual({
      ok: true,
      split: null,
    });
  });

  it('rejects a one-person split', () => {
    const r = buildSplitPayload({ enabled: true, method: 'equal', people: ['uid-a'], vals: {}, totalInEntryCurrency: 10, currency: 'USD' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least two/i);
  });

  it('omits values for an equal split and stores real uids', () => {
    const r = buildSplitPayload({ enabled: true, method: 'equal', people, vals: { 'uid-a': '1' }, totalInEntryCurrency: 10, currency: 'USD' });
    expect(r).toEqual({ ok: true, split: { enabled: true, method: 'equal', participantIds: people } });
  });

  it('rejects percents that do not add to 100', () => {
    const r = buildSplitPayload({
      enabled: true,
      method: 'percent',
      people,
      vals: { 'uid-a': '40', 'uid-b': '40' },
      totalInEntryCurrency: 10,
      currency: 'USD',
    });
    expect(r.ok).toBe(false);
  });

  it('accepts percents that add to 100', () => {
    const r = buildSplitPayload({
      enabled: true,
      method: 'percent',
      people,
      vals: { 'uid-a': '40', 'uid-b': '60' },
      totalInEntryCurrency: 10,
      currency: 'USD',
    });
    expect(r.ok && r.split).toMatchObject({ method: 'percent', values: { 'uid-a': 40, 'uid-b': 60 } });
  });

  it('stores amount-split values in USD, not the typed CAD', () => {
    const r = buildSplitPayload({
      enabled: true,
      method: 'amount',
      people,
      vals: { 'uid-a': '13.80', 'uid-b': '13.80' },
      totalInEntryCurrency: 27.6,
      currency: 'CAD',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.split?.values?.['uid-a']).toBeCloseTo(10, 2);
    expect(r.split?.values?.['uid-b']).toBeCloseTo(10, 2);
  });

  it('rejects amount splits that miss the total', () => {
    const r = buildSplitPayload({
      enabled: true,
      method: 'amount',
      people,
      vals: { 'uid-a': '5', 'uid-b': '4' },
      totalInEntryCurrency: 10,
      currency: 'USD',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a shares split where nobody has a share', () => {
    const r = buildSplitPayload({
      enabled: true,
      method: 'shares',
      people,
      vals: { 'uid-a': '0', 'uid-b': '' },
      totalInEntryCurrency: 10,
      currency: 'USD',
    });
    expect(r.ok).toBe(false);
  });
});

describe('lineItemsAreValid', () => {
  it('allows a negative discount line and rejects a nameless or zero line', () => {
    expect(lineItemsAreValid([{ name: 'Coupon', amount: '-2.5' }])).toBe(true);
    expect(lineItemsAreValid([{ name: 'Milk', amount: '0' }])).toBe(false);
    expect(lineItemsAreValid([{ name: '   ', amount: '3' }])).toBe(false);
    expect(lineItemsAreValid([])).toBe(true);
  });
});
