export type PremiumReady = { status: 'ready' | 'unavailable'; premium: boolean };

export function promoIsActive(
  d: { grantsPro?: unknown; freeUntil?: { toDate?: () => Date } | null } | undefined,
  now = Date.now(),
): boolean {
  if (!d) return false;
  const until = d.freeUntil?.toDate?.();
  return d.grantsPro === true || (!!until && until.getTime() > now);
}

/** Promo grant or RevenueCat sub unlocks Premium. A failed sub check is unavailable unless promo. */
export function combinePremium(promo: boolean, sub: boolean | null): PremiumReady {
  if (promo || sub) return { status: 'ready', premium: true };
  return { status: sub === null ? 'unavailable' : 'ready', premium: false };
}
