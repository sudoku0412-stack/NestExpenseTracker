/** Promo grant on promoRedemptions/{uid}: permanent grantsPro, or a future freeUntil Timestamp. */
export function promoGrantActive(
  data: { grantsPro?: unknown; freeUntil?: { toDate?: () => Date } | null } | undefined,
  now: number,
): boolean {
  if (!data) return false;
  const until = data.freeUntil?.toDate?.();
  return data.grantsPro === true || (!!until && until.getTime() > now);
}

/** RevenueCat sub is null when the worker could not be reached. Promo still unlocks Premium. */
export function premiumFromChecks(
  promo: boolean,
  sub: boolean | null,
): { status: 'ready' | 'unavailable'; premium: boolean } {
  if (promo || sub) return { status: 'ready', premium: true };
  return { status: sub === null ? 'unavailable' : 'ready', premium: false };
}
