/** Friendly text for the common Firebase Auth failures. */
export function authMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found'))
    return 'Email or password is incorrect.';
  if (code.includes('email-already-in-use')) return 'An account with this email already exists.';
  if (code.includes('weak-password')) return 'Use a password with at least 6 characters.';
  if (code.includes('invalid-email')) return 'Enter a valid email address.';
  if (code.includes('popup-closed')) return 'Sign-in was cancelled.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Try again in a few minutes.';
  if (code.includes('operation-not-allowed')) return 'This sign-in method is not turned on yet.';
  if (code.includes('account-exists-with-different-credential')) return 'An account with this email already exists. Sign in with the method you used before.';
  if (code.includes('unauthorized-domain')) return 'This website address is not authorised for sign-in yet.';
  return 'Something went wrong. Please try again.';
}
