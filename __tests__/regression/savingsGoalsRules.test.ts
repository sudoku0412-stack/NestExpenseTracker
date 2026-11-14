import * as fs from 'fs';
import * as path from 'path';

describe('Phase D firestore rules', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');

  it('gates savingsGoals on household membership like incomes', () => {
    expect(source).toMatch(/match \/savingsGoals\/\{gid\}/);
    expect(source).toMatch(/match \/incomes\/\{iid\}/);
  });

  it('keeps investment holdings owner-only under users/{uid}, not the household', () => {
    const usersBlock = source.slice(source.indexOf('match /users/{uid}'), source.indexOf('match /households/{hid}'));
    const householdBlock = source.slice(source.indexOf('match /households/{hid}'));
    expect(usersBlock).toMatch(/match \/investmentAccounts\/\{id\}/);
    expect(usersBlock).toMatch(/match \/investmentSnapshots\/\{id\}/);
    expect(usersBlock).toMatch(/request\.auth\.uid == uid/);
    expect(householdBlock).not.toMatch(/investmentAccounts/);
    expect(householdBlock).not.toMatch(/investmentSnapshots/);
  });
});
