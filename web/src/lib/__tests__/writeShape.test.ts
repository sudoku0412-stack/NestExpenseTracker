import { describe, expect, it } from 'vitest';
import {
  budgetAmountUsd,
  goalWrite,
  investmentWrite,
  settlementParties,
  settlementWrite,
} from '../writeShape';

describe('budgetAmountUsd', () => {
  it('rounds to cents and never stores a negative budget', () => {
    expect(budgetAmountUsd(10.456)).toBe(10.46);
    expect(budgetAmountUsd(-3)).toBe(0);
  });
});

describe('goalWrite / investmentWrite / settlementWrite', () => {
  it('trims names, clamps allocated cash, and stores empty notes as null', () => {
    expect(goalWrite({ name: '  Trip  ', targetUsd: 100, allocatedUsd: -5, notes: '  ' }, 'now')).toEqual({
      name: 'Trip',
      targetUsd: 100,
      allocatedUsd: 0,
      notes: null,
      createdAt: 'now',
      updatedAt: 'now',
    });
  });

  it('keeps an existing createdAt when editing a goal', () => {
    expect(goalWrite({ name: 'A', targetUsd: 1, allocatedUsd: 1, createdAt: 'old' }, 'now').createdAt).toBe('old');
  });

  it('trims investment names the same way', () => {
    expect(investmentWrite({
      name: ' TFSA ',
      kind: 'etf',
      contributedUsd: 1,
      valueUsd: 2,
      notes: undefined,
      createdAt: 'c',
      updatedAt: 'u',
    }).notes).toBeNull();
  });

  it('rounds a settlement amount', () => {
    expect(settlementWrite('a', 'b', 1.239, 't')).toEqual({ fromUid: 'a', toUid: 'b', amountUsd: 1.24, createdAt: 't' });
  });
});

describe('settlementParties', () => {
  it('records them paying you when they owe you', () => {
    expect(settlementParties('me', 'them', 40)).toEqual({ fromUid: 'them', toUid: 'me' });
  });

  it('records you paying them when you owe them', () => {
    expect(settlementParties('me', 'them', -12)).toEqual({ fromUid: 'me', toUid: 'them' });
  });
});
