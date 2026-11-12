import { describe, expect, it } from 'vitest';
import { convertEntryToUsd } from '@app/lib/currency';
import { buildSplit, remapSelfId } from '../splitForm';

describe('remapSelfId', () => {
  it('rewrites the legacy self key to the signed-in uid', () => {
    expect(remapSelfId('self', 'uid-1')).toBe('uid-1');
    expect(remapSelfId('uid-2', 'uid-1')).toBe('uid-2');
    expect(remapSelfId('self', undefined)).toBe('self');
  });
});

describe('buildSplit', () => {
  const people = ['a', 'b'];

  it('returns null when splitting is off', () => {
    expect(buildSplit({ enabled: false, method: 'equal', people, vals: {}, totalN: 10, currency: 'USD' })).toEqual({
      split: null,
    });
  });

  it('requires two people', () => {
    expect(buildSplit({ enabled: true, method: 'equal', people: ['a'], vals: {}, totalN: 10, currency: 'USD' })).toEqual({
      error: 'Choose at least two people to split with.',
    });
  });

  it('omits values for an equal split', () => {
    const out = buildSplit({ enabled: true, method: 'equal', people, vals: { a: '1' }, totalN: 10, currency: 'USD' });
    expect(out).toEqual({ split: { enabled: true, method: 'equal', participantIds: people } });
  });

  it('rejects percents that do not add to 100', () => {
    expect(
      buildSplit({ enabled: true, method: 'percent', people, vals: { a: '40', b: '40' }, totalN: 10, currency: 'USD' }),
    ).toEqual({ error: 'Percentages must add up to 100.' });
  });

  it('converts exact amounts from the entry currency into USD', () => {
    const out = buildSplit({
      enabled: true,
      method: 'amount',
      people,
      vals: { a: '6.9', b: '6.9' },
      totalN: 13.8,
      currency: 'CAD',
    });
    expect('split' in out && out.split?.values).toEqual({
      a: Math.round(convertEntryToUsd(6.9, 'CAD') * 100) / 100,
      b: Math.round(convertEntryToUsd(6.9, 'CAD') * 100) / 100,
    });
  });

  it('rejects amount splits that miss the total and share splits that are all zero', () => {
    expect(
      buildSplit({ enabled: true, method: 'amount', people, vals: { a: '1', b: '1' }, totalN: 10, currency: 'USD' }),
    ).toEqual({ error: 'Amounts must add up to the total.' });
    expect(
      buildSplit({ enabled: true, method: 'shares', people, vals: { a: '0', b: '' }, totalN: 10, currency: 'USD' }),
    ).toEqual({ error: 'Give at least one person a share.' });
  });
});
