export type PremiumStatus = 'loading' | 'ready' | 'unavailable';

export function promoIsActive(
  d: { grantsPro?: unknown; freeUntil?: { toDate?: () => Date } | null } | undefined | null,
  nowMs = Date.now(),
): boolean {
  if (!d) return false;
  const until = d.freeUntil?.toDate?.();
  return d.grantsPro === true || (!!until && until.getTime() > nowMs);
}

/** Promo grant OR an active RevenueCat subscription. If the API is down and
 *  there is no promo, status is unavailable rather than silently free. */
export function resolvePremiumStatus(
  promo: boolean,
  sub: boolean | null,
): { status: Exclude<PremiumStatus, 'loading'>; premium: boolean } {
  if (promo || sub) return { status: 'ready', premium: true };
  return { status: sub === null ? 'unavailable' : 'ready', premium: false };
}
