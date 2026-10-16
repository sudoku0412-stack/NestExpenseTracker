import { describe, expect, it } from 'vitest';
import { toGoal, toSettlement } from '../householdRows';

describe('toSettlement', () => {
  it('coerces a finite amount and stamps the household', () => {
    expect(toSettlement('s1', { fromUid: 'a', toUid: 'b', amountUsd: 12.5, createdAt: 't' }, 'h1')).toEqual({
      id: 's1',
      fromUid: 'a',
      toUid: 'b',
      amountUsd: 12.5,
      createdAt: 't',
      householdId: 'h1',
    });
  });

  it('treats a missing or non-finite amount as 0 so a bad cloud row cannot NaN balances', () => {
    expect(toSettlement('s2', { amountUsd: '12' }, 'h1').amountUsd).toBe(0);
    expect(toSettlement('s3', { amountUsd: Number.NaN }, 'h1').amountUsd).toBe(0);
    expect(toSettlement('s4', {}, 'h1')).toMatchObject({ fromUid: '', toUid: '', createdAt: '' });
  });
});

describe('toGoal', () => {
  it('keeps notes only when they are a string', () => {
    expect(toGoal('g1', { name: 'Trip', targetUsd: 100, allocatedUsd: 20, notes: 'soon' }, 'h1').notes).toBe('soon');
    expect(toGoal('g2', { name: 'Trip', targetUsd: 100, allocatedUsd: 20, notes: null }, 'h1').notes).toBeUndefined();
  });

  it('does not invent a target or allocation from junk numbers', () => {
    const g = toGoal('g3', { name: 1, targetUsd: '500', allocatedUsd: Infinity }, 'h1');
    expect(g).toMatchObject({ name: '', targetUsd: 0, allocatedUsd: 0, householdId: 'h1' });
  });
});
