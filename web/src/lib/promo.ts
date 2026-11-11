/** Promo-code Premium: an explicit grantsPro flag, or a freeUntil timestamp still in the future. */
export function promoGrantsPremium(
  d: { grantsPro?: unknown; freeUntil?: { toDate?: () => Date } | null } | undefined,
  now = Date.now(),
): boolean {
  if (!d) return false;
  const until = d.freeUntil?.toDate?.();
  return d.grantsPro === true || (!!until && until.getTime() > now);
}
