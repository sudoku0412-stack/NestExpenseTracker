export type RouteTarget = 'onboarding' | 'auth' | '(tabs)';

export type RouteState = {
  user: unknown;
  onboardingSeen: boolean;
};

/**
 * Routes the user reaches voluntarily (modals, edit screens). When
 * `target` resolves to `(tabs)` and the user is on one of these, leave
 * them alone — the guard's job is to force users to the auth gate, not
 * to drag them back to /(tabs) every time they open a modal.
 *
 * Signed-out / onboarding targets are NEVER sticky: Sign out from
 * Settings must still replace to /auth.
 */
export const STICKY_VOLUNTARY = new Set([
  'settings',
  'edit',
  'edit-profile',
  'edit-income',
  'add-income',
  'reports',
  'balances',
  'shared-expenses',
  'recurring',
  'households',
  'contacts-sync',
  'paywall',
  'scan-paystub',
  'savings-goals',
  'incomes',
  'review',
  'investments',
  'investment',
  'budgets',
]);

export function pickTarget(s: RouteState): RouteTarget {
  if (!s.onboardingSeen) return 'onboarding';
  if (!s.user) return 'auth';
  return '(tabs)';
}

export function targetToHref(t: RouteTarget): string {
  switch (t) {
    case 'onboarding':
      return '/onboarding';
    case 'auth':
      return '/auth';
    case '(tabs)':
      return '/(tabs)';
  }
}

export type AuthGuardState = RouteState & {
  current: string;
};

/**
 * Returns the href the root layout should `replace` to, or `null` when
 * the user should stay on the current screen.
 */
export function hrefForAuthGuard(s: AuthGuardState): string | null {
  const target = pickTarget(s);
  if (target === s.current) return null;
  // User is on a voluntary screen and the gate says they're cleared for
  // the app — leave them on it. Also bail when `current` is empty:
  // useSegments() can return [] for top-level modal routes in some
  // expo-router versions.
  if (target === '(tabs)' && (s.current === '' || STICKY_VOLUNTARY.has(s.current))) {
    return null;
  }
  // auth.tsx's "‹ Back to intro" link sends a signed-out user to
  // /onboarding voluntarily. pickTarget still resolves to 'auth' once
  // onboarding has been seen, so without this the guard would bounce
  // them straight back.
  if (target === 'auth' && s.current === 'onboarding') {
    return null;
  }
  // Password-reset email deep-links a signed-out user into
  // /reset-password. Same flash-and-bounce as onboarding without this.
  if (target === 'auth' && s.current === 'reset-password') {
    return null;
  }
  return targetToHref(target);
}
