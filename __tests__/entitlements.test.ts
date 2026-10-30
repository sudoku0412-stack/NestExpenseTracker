const mockConfigure = jest.fn();
const mockLogIn = jest.fn();
const mockLogOut = jest.fn();
const mockGetCustomerInfo = jest.fn();
const mockGetOfferings = jest.fn();
const mockPurchasePackage = jest.fn();
const mockRestorePurchases = jest.fn();
const mockAddListener = jest.fn();
const mockRemoveListener = jest.fn();

jest.mock('react-native-purchases', () => ({
  default: {
    configure: (...args: unknown[]) => mockConfigure(...args),
    logIn: (...args: unknown[]) => mockLogIn(...args),
    logOut: (...args: unknown[]) => mockLogOut(...args),
    getCustomerInfo: (...args: unknown[]) => mockGetCustomerInfo(...args),
    getOfferings: (...args: unknown[]) => mockGetOfferings(...args),
    purchasePackage: (...args: unknown[]) => mockPurchasePackage(...args),
    restorePurchases: (...args: unknown[]) => mockRestorePurchases(...args),
    addCustomerInfoUpdateListener: (...args: unknown[]) => mockAddListener(...args),
    removeCustomerInfoUpdateListener: (...args: unknown[]) => mockRemoveListener(...args),
  },
}));

import {
  PREMIUM_ENTITLEMENT_ID,
  isEntitlementsAvailable,
  configurePurchases,
  loginPurchases,
  logoutPurchases,
  getIsPremium,
  getManagementUrl,
  getOfferings,
  purchasePackage,
  restorePurchases,
  subscribeToEntitlementChanges,
} from '../lib/entitlements';

function customerInfoWith(activeEntitlementIds: string[]) {
  const active: Record<string, unknown> = {};
  for (const id of activeEntitlementIds) active[id] = { identifier: id };
  return { entitlements: { active } };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isEntitlementsAvailable', () => {
  it('true when react-native-purchases is linked', () => {
    expect(isEntitlementsAvailable()).toBe(true);
  });
});

describe('configurePurchases', () => {
  it('configures the SDK once with the given key', () => {
    configurePurchases('rc_test_key');
    expect(mockConfigure).toHaveBeenCalledWith({ apiKey: 'rc_test_key' });
  });

  it('no-ops on an undefined key', () => {
    mockConfigure.mockClear();
    configurePurchases(undefined);
    expect(mockConfigure).not.toHaveBeenCalled();
  });
});

describe('loginPurchases', () => {
  it('returns true when the premium entitlement is active after login', async () => {
    mockLogIn.mockResolvedValue({ customerInfo: customerInfoWith([PREMIUM_ENTITLEMENT_ID]) });
    const result = await loginPurchases('uid-1');
    expect(mockLogIn).toHaveBeenCalledWith('uid-1');
    expect(result).toBe(true);
  });

  it('returns false when no entitlement is active', async () => {
    mockLogIn.mockResolvedValue({ customerInfo: customerInfoWith([]) });
    const result = await loginPurchases('uid-1');
    expect(result).toBe(false);
  });
});

describe('logoutPurchases', () => {
  it('swallows the error RevenueCat throws for an already-anonymous user', async () => {
    mockLogOut.mockRejectedValue(new Error('already anonymous'));
    await expect(logoutPurchases()).resolves.toBeUndefined();
  });
});

describe('getIsPremium', () => {
  it('reflects the active entitlement map', async () => {
    mockGetCustomerInfo.mockResolvedValue(customerInfoWith([PREMIUM_ENTITLEMENT_ID]));
    expect(await getIsPremium()).toBe(true);
  });
});

describe('getManagementUrl', () => {
  it('returns the managementURL from CustomerInfo', async () => {
    mockGetCustomerInfo.mockResolvedValue({ ...customerInfoWith([]), managementURL: 'https://play.google.com/store/account/subscriptions' });
    expect(await getManagementUrl()).toBe('https://play.google.com/store/account/subscriptions');
  });

  it('returns null when there is nothing to manage', async () => {
    mockGetCustomerInfo.mockResolvedValue({ ...customerInfoWith([]), managementURL: null });
    expect(await getManagementUrl()).toBeNull();
  });
});

describe('getOfferings', () => {
  it('returns the RevenueCat offerings payload', async () => {
    const offerings = { current: { identifier: 'default' } };
    mockGetOfferings.mockResolvedValue(offerings);
    await expect(getOfferings()).resolves.toBe(offerings);
  });
});

describe('purchasePackage', () => {
  it('reports success and premium status on a completed purchase', async () => {
    mockPurchasePackage.mockResolvedValue({ customerInfo: customerInfoWith([PREMIUM_ENTITLEMENT_ID]) });
    const outcome = await purchasePackage({ identifier: 'monthly' } as never);
    expect(outcome).toEqual({ ok: true, isPremium: true });
  });

  it('reports userCancelled distinctly from a real failure', async () => {
    mockPurchasePackage.mockRejectedValue({ userCancelled: true, message: 'cancelled' });
    const outcome = await purchasePackage({ identifier: 'monthly' } as never);
    expect(outcome).toEqual({ ok: false, userCancelled: true, message: 'cancelled' });
  });

  it('reports a real failure as not user-cancelled', async () => {
    mockPurchasePackage.mockRejectedValue({ userCancelled: false, message: 'store error' });
    const outcome = await purchasePackage({ identifier: 'monthly' } as never);
    expect(outcome).toEqual({ ok: false, userCancelled: false, message: 'store error' });
  });
});

describe('restorePurchases', () => {
  it('returns the restored premium status', async () => {
    mockRestorePurchases.mockResolvedValue(customerInfoWith([PREMIUM_ENTITLEMENT_ID]));
    expect(await restorePurchases()).toBe(true);
  });
});

describe('subscribeToEntitlementChanges', () => {
  it('invokes the callback with the latest premium status and unsubscribes cleanly', () => {
    let capturedListener: ((info: unknown) => void) | undefined;
    mockAddListener.mockImplementation((listener) => {
      capturedListener = listener;
    });
    const cb = jest.fn();
    const unsubscribe = subscribeToEntitlementChanges(cb);
    expect(capturedListener).toBeDefined();
    capturedListener!(customerInfoWith([PREMIUM_ENTITLEMENT_ID]));
    expect(cb).toHaveBeenCalledWith(true);
    unsubscribe();
    expect(mockRemoveListener).toHaveBeenCalled();
  });
});
