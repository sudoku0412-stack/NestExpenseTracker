import * as fs from 'fs';
import * as path from 'path';

/**
 * Source-level contracts for firestore.rules. These are not a rules
 * emulator; they catch the class of regression where a new collection
 * is added without a membership/owner gate, or an existing gate is
 * accidentally widened (the original users/{uid} read path used to be
 * self-only and silently broke multi-member households).
 */

const SOURCE = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');

function matchBlock(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start < 0) {
    throw new Error(`missing rules block: ${header}`);
  }
  // The first `{` on the match line is the path wildcard (`{uid}`), not the body.
  const lineEnd = source.indexOf('\n', start);
  const brace = source.lastIndexOf('{', lineEnd === -1 ? source.length : lineEnd);
  if (brace < start) {
    throw new Error(`no opening brace for rules block: ${header}`);
  }
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed rules block: ${header}`);
}

const users = matchBlock(SOURCE, 'match /users/{uid}');
const investments = matchBlock(users, 'match /investmentAccounts/{id}');
const snapshots = matchBlock(users, 'match /investmentSnapshots/{id}');
const households = matchBlock(SOURCE, 'match /households/{hid}');
const receipts = matchBlock(households, 'match /receipts/{rid}');
const settlements = matchBlock(households, 'match /settlements/{sid}');
const incomes = matchBlock(households, 'match /incomes/{iid}');
const goals = matchBlock(households, 'match /savingsGoals/{gid}');
const invites = matchBlock(SOURCE, 'match /invites/{emailKey}');
const phoneInvites = matchBlock(SOURCE, 'match /phoneInvites/{phone}');
const phoneIndex = matchBlock(SOURCE, 'match /phoneIndex/{phone}');
const emailIndex = matchBlock(SOURCE, 'match /emailIndex/{emailKey}');
const promoCodes = matchBlock(SOURCE, 'match /promoCodes/{code}');
const promoRedemptions = matchBlock(SOURCE, 'match /promoRedemptions/{uid}');

describe('firestore.rules — personal investments (users/{uid} subcollections)', () => {
  it('investment accounts and snapshots are owner-only, not household-shared', () => {
    expect(investments).toMatch(/allow read, write:\s*if request\.auth != null && request\.auth\.uid == uid/);
    expect(snapshots).toMatch(/allow read, write:\s*if request\.auth != null && request\.auth\.uid == uid/);
    expect(investments).not.toMatch(/inSameHousehold|memberUids/);
    expect(snapshots).not.toMatch(/inSameHousehold|memberUids/);
    expect(households).not.toMatch(/investmentAccounts|investmentSnapshots/);
  });
});

describe('firestore.rules — household membership gates', () => {
  it('receipts, settlements, incomes, and savings goals all require membership', () => {
    for (const block of [receipts, settlements, incomes, goals]) {
      expect(block).toContain(
        'request.auth.uid in get(/databases/$(database)/documents/households/$(hid)).data.memberUids',
      );
    }
  });

  it('only the household owner can delete the household document', () => {
    expect(households).toMatch(
      /allow delete: if isMember\(\) && resource\.data\.ownerUid == request\.auth\.uid/,
    );
  });

  it('an invitee may add only themselves and cannot drop existing members', () => {
    expect(households).toContain('request.resource.data.memberUids.hasAll(resource.data.memberUids)');
    expect(households).toContain('request.auth.uid in request.resource.data.memberUids');
    expect(households).toContain('hasPendingInviteForThisHousehold()');
    expect(households).toContain('hasPendingPhoneInviteForThisHousehold()');
  });

  it('same-household members can read each others user profiles (balances / member list)', () => {
    expect(users).toContain('function inSameHousehold()');
    expect(users).toMatch(
      /allow read: if request\.auth != null && \(request\.auth\.uid == uid \|\| inSameHousehold\(\)\)/,
    );
    expect(users).toMatch(/allow write: if request\.auth != null && request\.auth\.uid == uid/);
  });
});

describe('firestore.rules — invites and discovery indexes', () => {
  it('email invites are publicly readable but cannot impersonate another inviter', () => {
    expect(invites).toMatch(/allow read: if true/);
    expect(invites).toContain('request.resource.data.invitedByUid == request.auth.uid');
    expect(invites).toContain('resource.data.invitedByUid == request.auth.uid');
    expect(invites).toContain('resource.data.email == request.auth.token.email.lower()');
  });

  it('phone invites require auth to read (no public landing page)', () => {
    expect(phoneInvites).toMatch(/allow read: if request\.auth != null/);
    expect(phoneInvites).not.toMatch(/allow read: if true/);
    expect(phoneInvites).toContain('request.resource.data.invitedByUid == request.auth.uid');
    expect(phoneInvites).toContain('resource.data.phone == request.auth.token.phone_number');
  });

  it('phone and email indexes are readable by any signed-in user but writable only for own uid', () => {
    for (const block of [phoneIndex, emailIndex]) {
      expect(block).toMatch(/allow read: if request\.auth != null/);
      expect(block).toContain('request.auth.uid == request.resource.data.uid');
      expect(block).toContain('request.auth.uid == resource.data.uid');
    }
  });
});

describe('firestore.rules — promo codes', () => {
  it('promoCodes are signed-in read-only (no client write rule)', () => {
    expect(promoCodes).toMatch(/allow read: if request\.auth != null/);
    expect(promoCodes).not.toMatch(/allow (write|create|update|delete)/);
  });

  it('promoRedemptions are create-once for the signed-in uid against an active code', () => {
    expect(promoRedemptions).toMatch(/allow read: if request\.auth != null && request\.auth\.uid == uid/);
    expect(promoRedemptions).toContain('request.auth.uid == uid');
    expect(promoRedemptions).toContain('request.resource.data.uid == uid');
    expect(promoRedemptions).toContain(
      'get(/databases/$(database)/documents/promoCodes/$(request.resource.data.code)).data.active == true',
    );
    expect(promoRedemptions).toMatch(/allow update, delete: if false/);
  });
});
