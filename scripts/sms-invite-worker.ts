/**
 * Cloudflare Worker with exactly one job: send an SMS via Twilio. Its
 * only reason to exist is that a Twilio Account SID + Auth Token can
 * never ship inside the mobile app — everything else about phone
 * invites (matching a contact to an existing user, writing the invite
 * doc) happens client-side in lib/phoneInvite.ts, no server needed for
 * that part. This worker doesn't touch Firestore at all.
 *
 * Why Cloudflare Workers and not Firebase Cloud Functions: Cloud
 * Functions require the Firebase project to be on the paid Blaze plan.
 * Workers has its own free tier (100k requests/day) — no billing setup
 * needed for this app's volume. Same pattern this repo already uses
 * for AI parsing — see scripts/parse-receipt-worker.ts.
 *
 * Deploy:
 *   1. Sign up at https://dash.cloudflare.com (free, no card)
 *   2. `npm install -g wrangler && wrangler login`
 *   3. `wrangler init balancesheet-sms-invite` in a new directory
 *      - Pick "Hello World Worker", TypeScript
 *   4. Copy THIS FILE to `src/index.ts` in that project.
 *   5. Set the secrets (Twilio creds never go in wrangler.toml):
 *
 *        wrangler secret put TWILIO_ACCOUNT_SID    # starts "AC..."
 *        wrangler secret put TWILIO_AUTH_USER      # Account SID again, or an API Key SID ("SK...")
 *        wrangler secret put TWILIO_AUTH_PASS      # Auth Token, or that API Key's Secret
 *        wrangler secret put TWILIO_FROM_NUMBER   # your Twilio number, E.164
 *        wrangler secret put APP_SECRET            # any random 32+ char string
 *
 *   6. `wrangler deploy` — note the URL like
 *      https://balancesheet-sms-invite.<your-subdomain>.workers.dev
 *   7. In the NestExpenseTracker repo, set EAS env vars on the preview profile:
 *
 *        eas env:create --environment preview --name SMS_WORKER_ENDPOINT \
 *            --value 'https://balancesheet-sms-invite.<sub>.workers.dev/send'
 *        eas env:create --environment preview --name SMS_WORKER_SECRET \
 *            --value '<the same APP_SECRET from step 5>'
 *
 *   8. Re-publish OTA: `eas update --branch preview --environment preview`
 *
 * Cost: free at this app's expected volume (an invite text sent only
 * when a user explicitly taps "send"). Twilio itself still charges
 * per-SMS on their side — a TRIAL Twilio account can only text numbers
 * you've manually verified in the Twilio console first.
 */

interface Env {
  /** Always the Account SID (starts "AC...") — goes in the URL path
   *  regardless of which credential type authenticates the request. */
  TWILIO_ACCOUNT_SID: string;
  /** Basic Auth username. Either the Account SID again (classic Auth
   *  Token flow) or a Twilio API Key SID (starts "SK...", recommended
   *  — scoped/revocable independently of the main account). */
  TWILIO_AUTH_USER: string;
  /** Basic Auth password — the Auth Token, or the API Key's Secret. */
  TWILIO_AUTH_PASS: string;
  TWILIO_FROM_NUMBER: string;
  APP_SECRET?: string;
}

interface SendRequestBody {
  to?: string; // E.164
  text?: string;
}

// Same best-effort per-isolate rate limit as parse-receipt-worker.ts —
// real SMS costs money, so this matters more here than for AI parsing.
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 5 };
const ipCounts = new Map<string, { count: number; resetAt: number }>();

export function shouldRateLimit(ip: string, now = Date.now()): boolean {
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT.maxRequests;
}

export function resetSmsRateLimitForTests(): void {
  ipCounts.clear();
}

export function validateSmsInvite(
  toRaw: string,
  textRaw: string,
): { ok: true; to: string; text: string } | { ok: false; error: string } {
  const to = toRaw.trim();
  const text = textRaw.trim();
  if (!to.startsWith('+')) return { ok: false, error: 'to must be E.164' };
  if (!text) return { ok: false, error: 'text required' };
  if (text.length > 320) return { ok: false, error: 'text too long' };
  return { ok: true, to, text };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

    const url = new URL(request.url);
    if (url.pathname !== '/send' && url.pathname !== '/') {
      return json({ error: 'unknown endpoint' }, 404);
    }

    if (env.APP_SECRET) {
      const provided = request.headers.get('x-app-secret') ?? '';
      if (provided !== env.APP_SECRET) {
        return json({ error: 'unauthorized' }, 401);
      }
    }

    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (shouldRateLimit(ip)) {
      return json({ error: 'rate-limited' }, 429);
    }

    let body: SendRequestBody;
    try {
      body = (await request.json()) as SendRequestBody;
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }
    const invite = validateSmsInvite(body.to ?? '', body.text ?? '');
    if (!invite.ok) return json({ error: invite.error }, 400);
    const { to, text } = invite;

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const form = new URLSearchParams({ To: to, From: env.TWILIO_FROM_NUMBER, Body: text });

    let twilioResp: Response;
    try {
      twilioResp = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${env.TWILIO_AUTH_USER}:${env.TWILIO_AUTH_PASS}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      });
    } catch (e) {
      return json({ error: 'upstream-error', detail: String(e) }, 502);
    }

    if (!twilioResp.ok) {
      const detail = await twilioResp.text();
      return json({ error: 'twilio-error', detail }, 502);
    }

    return json({ ok: true });
  },
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, x-app-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
