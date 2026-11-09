/**
 * nest-web-api: the small server the NestExpenseTracker website needs.
 *
 *   GET  /v1/premium        -> { premium: boolean }   RevenueCat entitlement for the signed-in user
 *   POST /v1/parse-receipt  -> parsed receipt JSON    Workers AI vision, Premium only
 *
 * Every request must carry a Firebase ID token (Authorization: Bearer ...). It is verified
 * here against Google's public keys, so the uid cannot be spoofed.
 */

import { corsHeaders, handleAuthed, json, type Env } from './logic';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

type Jwk = JsonWebKey & { kid: string };
let jwksCache: { keys: Jwk[]; at: number } | null = null;

const b64urlToBytes = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const decodeJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function getKeys(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < 60 * 60 * 1000) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('jwks');
  const { keys } = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys, at: Date.now() };
  return keys;
}

/** Returns the Firebase uid for a valid ID token, otherwise null. */
async function verifyIdToken(token: string, projectId: string): Promise<string | null> {
  try {
    const [h, p, sig] = token.split('.');
    if (!h || !p || !sig) return null;
    const header = decodeJson(h);
    const claims = decodeJson(p);
    if (header.alg !== 'RS256') return null;
    const now = Math.floor(Date.now() / 1000);
    if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (typeof claims.exp !== 'number' || claims.exp < now || typeof claims.sub !== 'string' || !claims.sub) return null;
    const jwk = (await getKeys()).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
    return ok ? (claims.sub as string) : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = corsHeaders(req, env.ALLOWED_ORIGINS);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const uid = bearer ? await verifyIdToken(bearer, env.FIREBASE_PROJECT_ID) : null;
    if (!uid) return json({ error: 'unauthorized' }, 401, headers);

    return handleAuthed(req, env, uid, headers);
  },
};
