import { describe, expect, it } from 'vitest';
import { remapSelfId, remapSelfIds, remapSelfValues } from '../splitSelf';

describe('remapSelfId', () => {
  it('replaces the legacy self placeholder with the signed-in uid', () => {
    expect(remapSelfId('self', 'u-me')).toBe('u-me');
    expect(remapSelfId('u-bob', 'u-me')).toBe('u-bob');
  });

  it('keeps self when there is no uid so a later save cannot invent a blank payer', () => {
    expect(remapSelfId('self', undefined)).toBe('self');
  });
});

describe('remapSelfIds / remapSelfValues', () => {
  it('rewrites participant ids and percent/amount keys together', () => {
    expect(remapSelfIds(['self', 'u-bob'], 'u-me')).toEqual(['u-me', 'u-bob']);
    expect(remapSelfValues({ self: 60, 'u-bob': 40 }, 'u-me')).toEqual({ 'u-me': 60, 'u-bob': 40 });
  });

  it('does not mutate the input map', () => {
    const values = { self: 1 };
    remapSelfValues(values, 'u-me');
    expect(values).toEqual({ self: 1 });
  });
});
