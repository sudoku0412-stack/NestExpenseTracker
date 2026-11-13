export type PremiumStatus = 'loading' | 'ready' | 'unavailable';
export type PremiumGateKind = 'content' | 'loading' | 'unavailable' | 'upgrade';

/** Promo grant: permanent `grantsPro`, or a `freeUntil` still in the future. */
export function promoGrantsPremium(
  d: { grantsPro?: unknown; freeUntil?: { toDate?: () => Date } | null } | undefined,
  now = Date.now(),
): boolean {
  if (!d) return false;
  const until = d.freeUntil?.toDate?.();
  return d.grantsPro === true || (!!until && until.getTime() > now);
}

export function premiumGateKind(status: PremiumStatus, premium: boolean): PremiumGateKind {
  if (premium) return 'content';
  if (status === 'loading') return 'loading';
  if (status === 'unavailable') return 'unavailable';
  return 'upgrade';
}
