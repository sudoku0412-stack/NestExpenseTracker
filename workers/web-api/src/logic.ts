/** Pure helpers for nest-web-api. Kept separate so auth, CORS, image and
 *  entitlement checks can be unit-tested without spinning a Worker. */

export const PREMIUM_ENTITLEMENT_ID = 'premium';
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/;

export function corsHeaders(origin: string, allowedOriginsCsv: string): Record<string, string> {
  const allowed = allowedOriginsCsv.split(',').map((s) => s.trim()).filter(Boolean);
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] ?? ''),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

/** True when RevenueCat reports the premium entitlement as never-expiring or not yet expired. */
export function entitlementIsActive(expiresDate: string | null | undefined, now = Date.now()): boolean {
  if (expiresDate === undefined) return false;
  return expiresDate === null || new Date(expiresDate).getTime() > now;
}

export function parseImageError(image: string): { status: number; error: string } | null {
  if (!IMAGE_DATA_URL.test(image)) return { status: 400, error: 'send a PNG, JPEG or WebP data URL' };
  if (image.length * 0.75 > MAX_IMAGE_BYTES) return { status: 413, error: 'image too large' };
  return null;
}

/** Slice the first JSON object out of model prose. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  return text.slice(start, end + 1);
}
