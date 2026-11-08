import { describe, expect, it } from 'vitest';
import { buildSplit, remapSelfId, remapSelfMap } from '../splitForm';

describe('remapSelfId', () => {
  it('rewrites the legacy self placeholder to the signed-in uid', () => {
    expect(remapSelfId('self', 'u1')).toBe('u1');
    expect(remapSelfId('u2', 'u1')).toBe('u2');
    expect(remapSelfId('self', undefined)).toBe('self');
  });

  it('rewrites keys in a values map the same way', () => {
    expect(remapSelfMap({ self: 40, bob: 60 }, 'u1')).toEqual({ u1: 40, bob: 60 });
  });
});

describe('buildSplit', () => {
  const toUsd = (n: number) => Math.round(n * 100) / 100;

  it('returns null when splitting is off', () => {
    expect(buildSplit(false, 'equal', ['a', 'b'], {}, 10, toUsd)).toEqual({ split: null });
  });

  it('rejects fewer than two people and percent/amount/shares that do not add up', () => {
    expect(buildSplit(true, 'equal', ['a'], {}, 10, toUsd)).toEqual({ error: 'Choose at least two people to split with.' });
    expect(buildSplit(true, 'percent', ['a', 'b'], { a: '40', b: '40' }, 10, toUsd)).toEqual({
      error: 'Percentages must add up to 100.',
    });
    expect(buildSplit(true, 'amount', ['a', 'b'], { a: '3', b: '3' }, 10, toUsd)).toEqual({
      error: 'Amounts must add up to the total.',
    });
    expect(buildSplit(true, 'shares', ['a', 'b'], { a: '0', b: '0' }, 10, toUsd)).toEqual({
      error: 'Give at least one person a share.',
    });
  });

  it('stores equal splits without a values map, and converts amount splits through toStoredAmount', () => {
    expect(buildSplit(true, 'equal', ['a', 'b'], {}, 10, toUsd)).toEqual({
      split: { enabled: true, method: 'equal', participantIds: ['a', 'b'] },
    });
    expect(buildSplit(true, 'amount', ['a', 'b'], { a: '4', b: '6' }, 10, (n) => n * 2)).toEqual({
      split: { enabled: true, method: 'amount', participantIds: ['a', 'b'], values: { a: 8, b: 12 } },
    });
  });
});
