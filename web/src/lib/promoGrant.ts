/** Promo-code grant on promoRedemptions/{uid}. Lifetime (`grantsPro`) or a freeUntil timestamp. */
export function promoIsActive(
  d: { grantsPro?: unknown; freeUntil?: { toDate?: () => Date } | null } | undefined,
  now = Date.now(),
): boolean {
  if (!d) return false;
  const until = d.freeUntil?.toDate?.();
  return d.grantsPro === true || (!!until && until.getTime() > now);
}
