/** Promo unlocks Premium if grantsPro is set, or until a Firestore Timestamp expiry. */
export function promoGrantsPremium(
  d: { grantsPro?: unknown; freeUntil?: { toDate?: () => Date } | null } | undefined | null,
  nowMs = Date.now(),
): boolean {
  if (!d) return false;
  const until = d.freeUntil?.toDate?.();
  return d.grantsPro === true || (!!until && until.getTime() > nowMs);
}

export type PremiumStatus = 'loading' | 'ready' | 'unavailable';

/** Promo OR an active subscription is Premium. A failed RevenueCat check is unavailable, not free. */
export function combinePremium(promo: boolean, sub: boolean | null): { status: PremiumStatus; premium: boolean } {
  if (promo || sub) return { status: 'ready', premium: true };
  return { status: sub === null ? 'unavailable' : 'ready', premium: false };
}
