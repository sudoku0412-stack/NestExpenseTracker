import { pickTarget, targetToHref, hrefForAuthGuard, STICKY_VOLUNTARY, RouteState } from '../lib/routeGuard';

const baseState: RouteState = {
  user: null,
  onboardingSeen: false,
};

describe('pickTarget — onboarding gate', () => {
  it('routes new users to onboarding', () => {
    expect(pickTarget(baseState)).toBe('onboarding');
  });

  it('keeps onboarding even if a user is somehow set (defensive)', () => {
    expect(pickTarget({ ...baseState, user: { uid: 'x' } })).toBe('onboarding');
  });
});

describe('pickTarget — auth gate', () => {
  it('routes onboarded users without a session to auth', () => {
    expect(pickTarget({ ...baseState, onboardingSeen: true })).toBe('auth');
  });

  it('treats undefined user as logged out', () => {
    const s = { ...baseState, onboardingSeen: true, user: undefined };
    expect(pickTarget(s)).toBe('auth');
  });
});

describe('pickTarget — signed-in gate', () => {
  it('routes onboarded, signed-in users straight to (tabs) — no verify/profile/biometric gates', () => {
    expect(
      pickTarget({ onboardingSeen: true, user: { uid: 'u1' } }),
    ).toBe('(tabs)');
  });

  it('onboarding always wins over auth', () => {
    expect(pickTarget({ onboardingSeen: false, user: { uid: 'u1' } })).toBe('onboarding');
  });

  it('auth always wins over (tabs) when signed out', () => {
    expect(pickTarget({ onboardingSeen: true, user: null })).toBe('auth');
  });
});

describe('targetToHref', () => {
  it('maps every target to a leading-slash route', () => {
    const targets = ['onboarding', 'auth', '(tabs)'] as const;
    for (const t of targets) {
      expect(targetToHref(t).startsWith('/')).toBe(true);
    }
  });

  it('produces stable hrefs that the router can replace to', () => {
    expect(targetToHref('onboarding')).toBe('/onboarding');
    expect(targetToHref('auth')).toBe('/auth');
    expect(targetToHref('(tabs)')).toBe('/(tabs)');
  });
});

describe('hrefForAuthGuard — sign-out from Settings', () => {
  it('replaces to /auth when a signed-out user is still on Settings', () => {
    expect(
      hrefForAuthGuard({ user: null, onboardingSeen: true, current: 'settings' }),
    ).toBe('/auth');
  });

  it('replaces to /auth from the Settings tab (current is (tabs))', () => {
    expect(
      hrefForAuthGuard({ user: null, onboardingSeen: true, current: '(tabs)' }),
    ).toBe('/auth');
  });

  it('does not bounce a signed-in user off Settings back to Home', () => {
    expect(
      hrefForAuthGuard({
        user: { uid: 'u1' },
        onboardingSeen: true,
        current: 'settings',
      }),
    ).toBeNull();
  });

  it('still allows signed-out users to stay on onboarding and reset-password', () => {
    expect(
      hrefForAuthGuard({ user: null, onboardingSeen: true, current: 'onboarding' }),
    ).toBeNull();
    expect(
      hrefForAuthGuard({ user: null, onboardingSeen: true, current: 'reset-password' }),
    ).toBeNull();
  });

  it('whitelists households so signed-in users are not bounced to Home', () => {
    expect(STICKY_VOLUNTARY.has('households')).toBe(true);
    expect(
      hrefForAuthGuard({
        user: { uid: 'u1' },
        onboardingSeen: true,
        current: 'households',
      }),
    ).toBeNull();
  });

  it('does not treat sticky voluntary routes as sticky when signed out', () => {
    // Settings / incomes / edit are sticky only for the (tabs) target.
    // After sign-out, pickTarget is auth — the user must still leave.
    expect(
      hrefForAuthGuard({ user: null, onboardingSeen: true, current: 'incomes' }),
    ).toBe('/auth');
    expect(
      hrefForAuthGuard({ user: null, onboardingSeen: true, current: 'edit' }),
    ).toBe('/auth');
    expect(
      hrefForAuthGuard({ user: null, onboardingSeen: true, current: 'review' }),
    ).toBe('/auth');
    expect(
      hrefForAuthGuard({ user: null, onboardingSeen: true, current: 'investments' }),
    ).toBe('/auth');
    expect(
      hrefForAuthGuard({ user: null, onboardingSeen: true, current: 'investment' }),
    ).toBe('/auth');
  });

  it('leaves a signed-in user alone when useSegments() reports an empty current', () => {
    expect(
      hrefForAuthGuard({
        user: { uid: 'u1' },
        onboardingSeen: true,
        current: '',
      }),
    ).toBeNull();
  });
});

describe('hrefForAuthGuard — pushed screens stay put for signed-in users', () => {
  it.each(['review', 'investments', 'investment', 'savings-goals', 'recurring'])(
    'does not bounce %s back to Home',
    (current) => {
      expect(hrefForAuthGuard({ user: { uid: 'u' }, onboardingSeen: true, current })).toBeNull();
    },
  );
});
