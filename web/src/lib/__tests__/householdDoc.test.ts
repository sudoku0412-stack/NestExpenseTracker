import { describe, expect, it } from 'vitest';
import { isHouseholdReady, nameFromUserDoc, parseHouseholdSnapshot } from '../householdDoc';

describe('parseHouseholdSnapshot', () => {
  it('defaults alerts on when the field was never written', () => {
    expect(parseHouseholdSnapshot({ budgets: { byCategory: { Groceries: 400 } } })).toEqual({
      budgets: { Groceries: 400 },
      budgetAlerts: true,
      customCategories: [],
      memberUids: [],
    });
  });

  it('honours an explicit alertsEnabled false', () => {
    expect(parseHouseholdSnapshot({ budgets: { alertsEnabled: false } }).budgetAlerts).toBe(false);
  });

  it('drops a missing household, a non-array customCategories, and a missing memberUids', () => {
    expect(parseHouseholdSnapshot(undefined)).toEqual({
      budgets: {},
      budgetAlerts: true,
      customCategories: [],
      memberUids: [],
    });
    expect(parseHouseholdSnapshot({ customCategories: { name: 'Pets' } }).customCategories).toEqual([]);
    expect(
      parseHouseholdSnapshot({
        customCategories: [{ name: 'Pets', color: '#D6336C' }],
        memberUids: ['u1', 'u2'],
      }),
    ).toMatchObject({
      customCategories: [{ name: 'Pets', color: '#D6336C' }],
      memberUids: ['u1', 'u2'],
    });
  });
});

describe('nameFromUserDoc', () => {
  it('prefers displayName, then the email local-part, then Member', () => {
    expect(nameFromUserDoc({ displayName: 'Ada', email: 'ada@example.com' })).toEqual({
      name: 'Ada',
      email: 'ada@example.com',
    });
    expect(nameFromUserDoc({ displayName: '', email: 'ada@example.com' })).toEqual({
      name: 'ada',
      email: 'ada@example.com',
    });
    expect(nameFromUserDoc({ email: 'ada@example.com' })).toEqual({ name: 'ada', email: 'ada@example.com' });
    expect(nameFromUserDoc({})).toEqual({ name: 'Member', email: null });
    expect(nameFromUserDoc(undefined)).toEqual({ name: 'Member', email: null });
  });
});

describe('isHouseholdReady', () => {
  it('needs a household id plus receipts, incomes and settlements — not goals', () => {
    expect(isHouseholdReady(null, { receipts: true, incomes: true, settlements: true })).toBe(false);
    expect(isHouseholdReady('hh1', { receipts: true, incomes: false, settlements: true })).toBe(false);
    expect(isHouseholdReady('hh1', { receipts: true, incomes: true, settlements: true })).toBe(true);
  });
});
