const mockRequestPermissionsAsync = jest.fn();
const mockGetContactsAsync = jest.fn();

jest.mock('expo-contacts', () => ({
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  getContactsAsync: (...args: unknown[]) => mockGetContactsAsync(...args),
  Fields: { PhoneNumbers: 'phoneNumbers', Emails: 'emails' },
}));

const mockLookupUserByPhone = jest.fn();
const mockLookupUserByEmail = jest.fn();

jest.mock('../lib/cloudSync', () => ({
  lookupUserByPhone: (...args: unknown[]) => mockLookupUserByPhone(...args),
  lookupUserByEmail: (...args: unknown[]) => mockLookupUserByEmail(...args),
}));

import {
  isContactsSyncAvailable,
  readAllContacts,
  matchContacts,
  type DeviceContact,
} from '../lib/contactsSync';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isContactsSyncAvailable', () => {
  it('true when expo-contacts is linked', () => {
    expect(isContactsSyncAvailable()).toBe(true);
  });
});

describe('readAllContacts', () => {
  it('returns null when permission is denied', async () => {
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'denied' });
    const result = await readAllContacts();
    expect(result).toBeNull();
    expect(mockGetContactsAsync).not.toHaveBeenCalled();
  });

  it('normalizes and dedupes phones/emails, drops contacts with neither', async () => {
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockGetContactsAsync.mockResolvedValue({
      data: [
        {
          id: '1',
          name: 'Jane Doe',
          phoneNumbers: [{ number: '+1 416 555 1234' }, { number: '4165551234' }],
          emails: [{ email: 'Jane@Example.com ' }],
        },
        { id: '2', name: 'No Contact Info', phoneNumbers: [], emails: [] },
        { id: '3', name: 'Bad Number Only', phoneNumbers: [{ number: '123' }], emails: [] },
      ],
    });
    const result = await readAllContacts();
    expect(result).toEqual([
      { id: '1', name: 'Jane Doe', phones: ['+14165551234'], emails: ['jane@example.com'] },
    ]);
  });

  it('returns null when expo-contacts is not linked', async () => {
    jest.resetModules();
    jest.doMock('expo-contacts', () => {
      throw new Error('not linked');
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const fresh = require('../lib/contactsSync');
    const result = await fresh.readAllContacts();
    expect(result).toBeNull();
  });
});

describe('matchContacts', () => {
  const contacts: DeviceContact[] = [
    { id: '1', name: 'Phone Match', phones: ['+14165551111'], emails: [] },
    { id: '2', name: 'Email Match', phones: [], emails: ['found@example.com'] },
    { id: '3', name: 'Both Match', phones: ['+14165553333'], emails: ['also-found@example.com'] },
    { id: '4', name: 'No Match', phones: ['+14165554444'], emails: ['nobody@example.com'] },
  ];

  it('splits contacts into matched (phone preferred over email) and unmatched', async () => {
    mockLookupUserByPhone.mockImplementation(async (phone: string) => {
      if (phone === '+14165551111') return { uid: 'u1', displayName: 'Phone User', pushToken: 'tok-1' };
      if (phone === '+14165553333') return { uid: 'u3', displayName: 'Both User', pushToken: 'tok-3' };
      return null;
    });
    mockLookupUserByEmail.mockImplementation(async (email: string) => {
      if (email === 'found@example.com') return { uid: 'u2', displayName: 'Email User', pushToken: 'tok-2' };
      if (email === 'also-found@example.com')
        return { uid: 'u3-email', displayName: 'Should Not Win', pushToken: 'tok-should-not-win' };
      return null;
    });

    const result = await matchContacts(contacts);

    expect(result.unmatched.map((c) => c.id)).toEqual(['4']);
    expect(result.matched).toHaveLength(3);

    const byId = new Map(result.matched.map((m) => [m.contact.id, m]));
    expect(byId.get('1')).toMatchObject({ matchedVia: 'phone', uid: 'u1', pushToken: 'tok-1' });
    expect(byId.get('2')).toMatchObject({ matchedVia: 'email', uid: 'u2', pushToken: 'tok-2' });
    // Contact 3 matches on both — phone must win, not the email index hit.
    expect(byId.get('3')).toMatchObject({ matchedVia: 'phone', uid: 'u3', pushToken: 'tok-3' });
  });

  it('dedupes lookups for a value shared by multiple contacts', async () => {
    mockLookupUserByPhone.mockResolvedValue({ uid: 'shared', displayName: 'Shared' });
    mockLookupUserByEmail.mockResolvedValue(null);
    const shared: DeviceContact[] = [
      { id: 'a', name: 'A', phones: ['+14165550000'], emails: [] },
      { id: 'b', name: 'B', phones: ['+14165550000'], emails: [] },
    ];
    await matchContacts(shared);
    expect(mockLookupUserByPhone).toHaveBeenCalledTimes(1);
  });

  it('returns everything unmatched when nothing hits', async () => {
    mockLookupUserByPhone.mockResolvedValue(null);
    mockLookupUserByEmail.mockResolvedValue(null);
    const result = await matchContacts(contacts);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(4);
  });

  it('no-ops without lookups on an empty contact list', async () => {
    await expect(matchContacts([])).resolves.toEqual({ matched: [], unmatched: [] });
    expect(mockLookupUserByPhone).not.toHaveBeenCalled();
    expect(mockLookupUserByEmail).not.toHaveBeenCalled();
  });

  it('caps concurrent phone lookups so a large book does not burst Firestore', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockLookupUserByPhone.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return null;
    });
    mockLookupUserByEmail.mockResolvedValue(null);

    const many: DeviceContact[] = Array.from({ length: 45 }, (_, i) => ({
      id: String(i),
      name: `C${i}`,
      phones: [`+1416555${String(i).padStart(4, '0')}`],
      emails: [],
    }));
    await matchContacts(many);

    expect(mockLookupUserByPhone).toHaveBeenCalledTimes(45);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(20);
  });

  it('looks up unique phones and emails in parallel, not one collection then the other', async () => {
    let phoneStarted = false;
    let emailStartedWhilePhoneInFlight = false;
    mockLookupUserByPhone.mockImplementation(async () => {
      phoneStarted = true;
      await Promise.resolve();
      return null;
    });
    mockLookupUserByEmail.mockImplementation(async () => {
      if (phoneStarted) emailStartedWhilePhoneInFlight = true;
      return null;
    });

    await matchContacts([
      { id: '1', name: 'Both', phones: ['+14165550000'], emails: ['a@example.com'] },
    ]);

    expect(emailStartedWhilePhoneInFlight).toBe(true);
    expect(mockLookupUserByPhone).toHaveBeenCalledTimes(1);
    expect(mockLookupUserByEmail).toHaveBeenCalledTimes(1);
  });
});
