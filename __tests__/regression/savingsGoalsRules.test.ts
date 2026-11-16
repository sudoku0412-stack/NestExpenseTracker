import * as fs from 'fs';
import * as path from 'path';

describe('Phase D firestore rules', () => {
  it('gates savingsGoals on household membership like incomes', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');
    expect(source).toMatch(/match \/savingsGoals\/\{gid\}/);
    expect(source).toMatch(/match \/incomes\/\{iid\}/);
  });

  it('keeps investment holdings owner-only under users/{uid}, never the household', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');
    expect(source).toMatch(/match \/investmentAccounts\/\{id\}/);
    expect(source).toMatch(/match \/investmentSnapshots\/\{id\}/);
    const accounts = source.slice(source.indexOf('match /investmentAccounts/{id}'));
    const accountsBlock = accounts.slice(0, accounts.indexOf('match /investmentSnapshots/{id}'));
    expect(accountsBlock).toMatch(/request\.auth\.uid == uid/);
    expect(accountsBlock).not.toMatch(/isMember\(\)/);
  });
});
