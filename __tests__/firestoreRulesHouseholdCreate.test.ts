import * as fs from 'fs';
import * as path from 'path';

/**
 * Source-level contracts for household create + membership join-table
 * rules. Draft PR #113 already locks investments / invite / promo gates;
 * these are the remaining load-bearing paths:
 *   - solo-household bootstrap (isCreating)
 *   - members/{uid} is existing-members only (invitees cannot write it
 *     before they are on memberUids — which is why ensureHouseholdForUser
 *     never batches a members doc)
 *   - users/{uid}/memberships/{hid} is self-write only
 *   - email invites key off token.email.lower()
 */

const SOURCE = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');

function matchBlock(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start < 0) {
    throw new Error(`missing rules block: ${header}`);
  }
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
const memberships = matchBlock(users, 'match /memberships/{hid}');
const households = matchBlock(SOURCE, 'match /households/{hid}');
const members = matchBlock(households, 'match /members/{memberUid}');
const invites = matchBlock(SOURCE, 'match /invites/{emailKey}');
const phoneInvites = matchBlock(SOURCE, 'match /phoneInvites/{phone}');

describe('firestore.rules — household create (ensureHouseholdForUser)', () => {
  it('lets a signed-in user create a household only when they put themselves in memberUids', () => {
    expect(households).toContain('function isCreating()');
    expect(households).toContain('request.auth.uid in request.resource.data.memberUids');
    expect(households).toMatch(/allow create: if isCreating\(\)/);
  });

  it('does not let an unauthenticated client create a household', () => {
    expect(households).toContain('function isCreating()');
    const creating = households.slice(
      households.indexOf('function isCreating()'),
      households.indexOf('allow create:'),
    );
    expect(creating).toContain('request.auth != null');
  });
});

describe('firestore.rules — members subcollection vs memberships join table', () => {
  it('household members/{uid} is gated on the parent household memberUids (not self-uid alone)', () => {
    expect(members).toContain(
      'request.auth.uid in get(/databases/$(database)/documents/households/$(hid)).data.memberUids',
    );
    expect(members).not.toMatch(/request\.auth\.uid == memberUid/);
  });

  it('users/{uid}/memberships/{hid} is self-read/write only (invite-accept is still a self-write)', () => {
    expect(memberships).toMatch(
      /allow read, write: if request\.auth != null && request\.auth\.uid == uid/,
    );
    expect(memberships).not.toMatch(/memberUids|inSameHousehold/);
  });
});

describe('firestore.rules — invite lookup keys', () => {
  it('email-invite household reads lower-case the auth email to match the doc id', () => {
    expect(households).toContain('request.auth.token.email.lower()');
    expect(households).toContain(
      'exists(/databases/$(database)/documents/invites/$(request.auth.token.email.lower()))',
    );
    expect(invites).toContain('resource.data.email == request.auth.token.email.lower()');
  });

  it('phone-invite household reads use the verified token phone_number, not email', () => {
    expect(households).toContain('request.auth.token.phone_number');
    expect(households).toContain(
      'exists(/databases/$(database)/documents/phoneInvites/$(request.auth.token.phone_number))',
    );
    expect(phoneInvites).toContain('resource.data.phone == request.auth.token.phone_number');
    expect(phoneInvites).not.toContain('token.email');
  });
});
