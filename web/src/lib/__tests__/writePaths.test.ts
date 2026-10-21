import { describe, expect, it } from 'vitest';
import {
  householdDoc,
  householdRoot,
  stopRecurringPatch,
  userInvestmentAccount,
  userInvestmentSnapshot,
} from '../writePaths';

describe('writePaths', () => {
  it('keeps receipts, incomes, settlements and goals under the household', () => {
    expect(householdRoot('hh1')).toEqual(['households', 'hh1']);
    expect(householdDoc('hh1', 'receipts', 'r1')).toEqual(['households', 'hh1', 'receipts', 'r1']);
    expect(householdDoc('hh1', 'incomes', 'i1')).toEqual(['households', 'hh1', 'incomes', 'i1']);
    expect(householdDoc('hh1', 'settlements', 's1')).toEqual(['households', 'hh1', 'settlements', 's1']);
    expect(householdDoc('hh1', 'savingsGoals', 'g1')).toEqual(['households', 'hh1', 'savingsGoals', 'g1']);
  });

  it('writes investment accounts and snapshots under users/{uid}, never a household', () => {
    expect(userInvestmentAccount('u1', 'a1')).toEqual(['users', 'u1', 'investmentAccounts', 'a1']);
    expect(userInvestmentSnapshot('u1', 'snap1')).toEqual(['users', 'u1', 'investmentSnapshots', 'snap1']);
    expect(userInvestmentAccount('u1', 'a1').join('/')).not.toContain('households');
    expect(userInvestmentSnapshot('u1', 'snap1').join('/')).not.toContain('households');
  });

  it('stop-recurring writes null so the schedule is cleared, not deleted as a doc', () => {
    expect(stopRecurringPatch('2026-10-21T13:00:00.000Z')).toEqual({
      recurring: null,
      updatedAt: '2026-10-21T13:00:00.000Z',
    });
  });
});
