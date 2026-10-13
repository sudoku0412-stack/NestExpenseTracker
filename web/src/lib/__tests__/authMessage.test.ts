import { describe, expect, it } from 'vitest';
import { authMessage } from '../authMessage';

describe('authMessage', () => {
  it('collapses credential failures so sign-in cannot enumerate accounts', () => {
    const msg = 'Email or password is incorrect.';
    expect(authMessage({ code: 'auth/invalid-credential' })).toBe(msg);
    expect(authMessage({ code: 'auth/wrong-password' })).toBe(msg);
    expect(authMessage({ code: 'auth/user-not-found' })).toBe(msg);
  });

  it('maps the remaining Firebase codes the login page can hit', () => {
    expect(authMessage({ code: 'auth/email-already-in-use' })).toBe('An account with this email already exists.');
    expect(authMessage({ code: 'auth/weak-password' })).toBe('Use a password with at least 6 characters.');
    expect(authMessage({ code: 'auth/invalid-email' })).toBe('Enter a valid email address.');
    expect(authMessage({ code: 'auth/popup-closed-by-user' })).toBe('Sign-in was cancelled.');
    expect(authMessage({ code: 'auth/too-many-requests' })).toBe('Too many attempts. Try again in a few minutes.');
    expect(authMessage({ code: 'auth/operation-not-allowed' })).toBe('This sign-in method is not turned on yet.');
    expect(authMessage({ code: 'auth/account-exists-with-different-credential' })).toBe(
      'An account with this email already exists. Sign in with the method you used before.',
    );
    expect(authMessage({ code: 'auth/unauthorized-domain' })).toBe('This website address is not authorised for sign-in yet.');
  });

  it('does not echo raw codes or unknown error text', () => {
    expect(authMessage({ code: 'auth/network-request-failed', message: 'SECRET' })).toBe('Something went wrong. Please try again.');
    expect(authMessage(null)).toBe('Something went wrong. Please try again.');
    expect(authMessage('auth/invalid-email')).toBe('Something went wrong. Please try again.');
  });
});
