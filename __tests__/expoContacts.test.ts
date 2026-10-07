/**
 * expo-contacts is lazy-required so an unrebuilt native binary does
 * not crash every screen that imports contactsSync. The miss is cached
 * (undefined vs null) so we do not keep require()-ing a missing module.
 */

describe('loadContacts', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('expo-contacts');
  });

  it('returns the native module when it is linked', () => {
    const fake = { Fields: { PhoneNumbers: 'phoneNumbers' } };
    jest.resetModules();
    jest.doMock('expo-contacts', () => fake);
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { loadContacts } = require('../lib/expoContacts');
    expect(loadContacts()).toBe(fake);
  });

  it('returns null when the native module is not linked, and does not retry', () => {
    let loads = 0;
    jest.resetModules();
    jest.doMock('expo-contacts', () => {
      loads += 1;
      throw new Error('not linked');
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { loadContacts } = require('../lib/expoContacts');
    expect(loadContacts()).toBeNull();
    expect(loadContacts()).toBeNull();
    expect(loads).toBe(1);
  });
});
