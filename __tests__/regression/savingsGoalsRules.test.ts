import * as fs from 'fs';
import * as path from 'path';

describe('Phase D firestore rules', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');

  it('gates savingsGoals on household membership like incomes', () => {
    expect(source).toMatch(/match \/savingsGoals\/\{gid\}/);
    expect(source).toMatch(/match \/incomes\/\{iid\}/);
  });

  it('keeps personal investments under users/{uid} owner-only, not the household', () => {
    expect(source).toMatch(/match \/investmentAccounts\/\{id\}/);
    expect(source).toMatch(/match \/investmentSnapshots\/\{id\}/);
    const accounts = source.slice(source.indexOf('match /investmentAccounts/{id}'));
    expect(accounts).toMatch(/request\.auth\.uid == uid/);
    expect(source).not.toMatch(/match \/households\/\{hid\}[\s\S]*investmentAccounts/);
  });

  it('lets a user create only their own promo redemption and never update or delete it', () => {
    expect(source).toMatch(/match \/promoRedemptions\/\{uid\}/);
    expect(source).toMatch(/allow update, delete: if false/);
  });
});
