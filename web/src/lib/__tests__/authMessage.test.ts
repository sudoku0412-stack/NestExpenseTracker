import { describe, expect, it } from 'vitest';
import { authMessage } from '../authMessage';

describe('authMessage', () => {
  it('does not enumerate whether the email exists', () => {
    const msg = 'Email or password is incorrect.';
    expect(authMessage({ code: 'auth/invalid-credential' })).toBe(msg);
    expect(authMessage({ code: 'auth/wrong-password' })).toBe(msg);
    expect(authMessage({ code: 'auth/user-not-found' })).toBe(msg);
  });

  it('covers the other common Firebase codes', () => {
    expect(authMessage({ code: 'auth/email-already-in-use' })).toMatch(/already exists/);
    expect(authMessage({ code: 'auth/weak-password' })).toMatch(/6 characters/);
    expect(authMessage({ code: 'auth/invalid-email' })).toMatch(/valid email/);
    expect(authMessage({ code: 'auth/popup-closed-by-user' })).toMatch(/cancelled/);
    expect(authMessage({ code: 'auth/too-many-requests' })).toMatch(/Too many/);
    expect(authMessage({ code: 'auth/operation-not-allowed' })).toMatch(/not turned on/);
    expect(authMessage({ code: 'auth/account-exists-with-different-credential' })).toMatch(/method you used before/);
    expect(authMessage({ code: 'auth/unauthorized-domain' })).toMatch(/not authorised/);
    expect(authMessage({ code: 'auth/network-request-failed' })).toBe('Something went wrong. Please try again.');
    expect(authMessage('nope')).toBe('Something went wrong. Please try again.');
  });
});
