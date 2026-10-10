export type PremiumStatus = 'loading' | 'ready' | 'unavailable';

/** Promo grant on the user's own promoRedemptions doc (same shape as mobile). */
export function promoGrantsPremium(
  d: { grantsPro?: boolean; freeUntil?: { toDate?: () => Date } | null } | undefined | null,
  now = Date.now(),
): boolean {
  if (!d) return false;
  const until = d.freeUntil?.toDate?.();
  return d.grantsPro === true || (!!until && until.getTime() > now);
}

/** Combine promo + RevenueCat. A failed RC check is `unavailable` only when promo is also off. */
export function premiumFromChecks(
  promo: boolean,
  subscription: boolean | null,
): { status: Exclude<PremiumStatus, 'loading'>; premium: boolean } {
  if (promo || subscription) return { status: 'ready', premium: true };
  return { status: subscription === null ? 'unavailable' : 'ready', premium: false };
}
