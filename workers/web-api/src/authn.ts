/**
 * Request-guard helpers for nest-web-api.
 *
 * Kept separate from the Worker fetch handler (and from any Premium/image
 * helpers) so the JWT + CORS contracts can be unit-tested without crypto
 * or a Workers runtime. Signature verification still happens in index.ts
 * after these checks pass.
 */

export type JwtHeader = { alg?: unknown; kid?: unknown };
export type JwtClaims = {
  aud?: unknown;
  iss?: unknown;
  exp?: unknown;
  sub?: unknown;
};

export function b64urlToBytes(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export function decodeJson(s: string): unknown {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

/** First three JWT segments, matching the Worker’s existing split. */
export function splitJwt(token: string): { header: string; payload: string; signature: string } | null {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  return { header, payload, signature };
}

export function readJwtHeaderAndClaims(token: string): {
  header: JwtHeader;
  claims: JwtClaims;
  signingInput: string;
  signature: string;
} | null {
  try {
    const parts = splitJwt(token);
    if (!parts) return null;
    return {
      header: decodeJson(parts.header) as JwtHeader,
      claims: decodeJson(parts.payload) as JwtClaims,
      signingInput: `${parts.header}.${parts.payload}`,
      signature: parts.signature,
    };
  } catch {
    return null;
  }
}

/**
 * Firebase ID-token claim checks that run before JWKS lookup.
 * Returns a short reason, or null when the claims are acceptable.
 */
export function firebaseJwtClaimError(
  header: JwtHeader,
  claims: JwtClaims,
  projectId: string,
  nowSec: number,
): 'alg' | 'aud' | 'iss' | 'exp' | 'sub' | null {
  if (header.alg !== 'RS256') return 'alg';
  if (claims.aud !== projectId) return 'aud';
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) return 'iss';
  if (typeof claims.exp !== 'number' || claims.exp < nowSec) return 'exp';
  if (typeof claims.sub !== 'string' || !claims.sub) return 'sub';
  return null;
}

export function firebaseUidFromClaims(
  header: JwtHeader,
  claims: JwtClaims,
  projectId: string,
  nowSec: number,
): string | null {
  if (firebaseJwtClaimError(header, claims, projectId, nowSec)) return null;
  return claims.sub as string;
}

/** Strip a Bearer prefix; empty / missing header becomes ''. */
export function bearerToken(authorization: string | null | undefined): string {
  return (authorization ?? '').replace(/^Bearer\s+/i, '');
}

export function corsOrigin(requestOrigin: string, allowedCsv: string): string {
  const allowed = allowedCsv.split(',').map((s) => s.trim());
  return allowed.includes(requestOrigin) ? requestOrigin : (allowed[0] ?? '');
}

export function corsHeaders(requestOrigin: string, allowedCsv: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': corsOrigin(requestOrigin, allowedCsv),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}
