import { describe, expect, it } from 'vitest';
import { lookupMemberName, nameFromUserDoc } from '../memberName';

describe('nameFromUserDoc', () => {
  it('prefers displayName, then the email local part, then Member', () => {
    expect(nameFromUserDoc('Ada', 'ada@x.com')).toBe('Ada');
    expect(nameFromUserDoc('', 'ada@x.com')).toBe('ada');
    expect(nameFromUserDoc(undefined, 'ada@x.com')).toBe('ada');
    expect(nameFromUserDoc('', '')).toBe('Member');
    expect(nameFromUserDoc(null, null)).toBe('Member');
  });
});

describe('lookupMemberName', () => {
  const byUid = new Map([['u1', 'Ada']]);

  it('returns the mapped name, Member for unknown or missing uid', () => {
    expect(lookupMemberName(byUid, 'u1')).toBe('Ada');
    expect(lookupMemberName(byUid, 'gone')).toBe('Member');
    expect(lookupMemberName(byUid, null)).toBe('Member');
    expect(lookupMemberName(byUid, undefined)).toBe('Member');
    expect(lookupMemberName(byUid, '')).toBe('Member');
  });
});
