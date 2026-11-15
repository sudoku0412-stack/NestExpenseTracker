/** Promo grant: permanent Premium (`grantsPro`) or a still-open `freeUntil` timestamp. */
export function promoGrantsPremium(
  d: { grantsPro?: unknown; freeUntil?: { toDate?: () => Date } | null },
  now = Date.now(),
): boolean {
  const until = d.freeUntil?.toDate?.();
  return d.grantsPro === true || (!!until && until.getTime() > now);
}
