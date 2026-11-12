export const PREMIUM_ENTITLEMENT_ID = 'premium';
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function corsHeaders(origin: string, allowedCsv: string): Record<string, string> {
  const allowed = allowedCsv.split(',').map((s) => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function bearerToken(header: string | null | undefined): string {
  return (header ?? '').replace(/^Bearer\s+/i, '');
}

export function claimsAreValid(
  header: { alg?: unknown; kid?: unknown },
  claims: { aud?: unknown; iss?: unknown; exp?: unknown; sub?: unknown },
  projectId: string,
  nowSec: number,
): boolean {
  if (header.alg !== 'RS256') return false;
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) return false;
  if (typeof claims.exp !== 'number' || claims.exp < nowSec || typeof claims.sub !== 'string' || !claims.sub) return false;
  return true;
}

export function checkImageDataUrl(image: string): { ok: true } | { error: string; status: number } {
  if (!/^data:image\/(png|jpe?g|webp);base64,/.test(image)) {
    return { error: 'send a PNG, JPEG or WebP data URL', status: 400 };
  }
  if (image.length * 0.75 > MAX_IMAGE_BYTES) return { error: 'image too large', status: 413 };
  return { ok: true };
}

export function entitlementActive(ent: { expires_date: string | null } | undefined, now = Date.now()): boolean {
  if (!ent) return false;
  return ent.expires_date === null || new Date(ent.expires_date).getTime() > now;
}

export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  return text.slice(start, end + 1);
}
