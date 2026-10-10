export const PREMIUM_ENTITLEMENT_ID = 'premium';
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const RECEIPT_IMAGE_RE = /^data:image\/(png|jpe?g|webp);base64,/;

export function isPremiumEntitlement(
  ent: { expires_date: string | null } | undefined,
  now = Date.now(),
): boolean {
  if (!ent) return false;
  return ent.expires_date === null || new Date(ent.expires_date).getTime() > now;
}

export function premiumFromSubscriber(
  body: { subscriber?: { entitlements?: Record<string, { expires_date: string | null }> } },
  now = Date.now(),
): boolean {
  return isPremiumEntitlement(body.subscriber?.entitlements?.[PREMIUM_ENTITLEMENT_ID], now);
}

export function receiptImageError(image: string): 'format' | 'size' | null {
  if (!RECEIPT_IMAGE_RE.test(image)) return 'format';
  if (image.length * 0.75 > MAX_IMAGE_BYTES) return 'size';
  return null;
}

export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  return text.slice(start, end + 1);
}
