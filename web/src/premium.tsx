import { doc, getDoc } from 'firebase/firestore';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import { db } from './firebase';

export const API_BASE = 'https://nest-web-api.kmaz285.workers.dev';
export const APP_STORE = 'https://apps.apple.com/us/app/nestexpensetracker/id6797353891';
export const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.kaushikmajumder.receiptscanner';

type Status = 'loading' | 'ready' | 'unavailable';
interface PremiumValue { status: Status; premium: boolean }
const Ctx = createContext<PremiumValue>({ status: 'loading', premium: false });

/** Premium = an active RevenueCat subscription (checked by the web API, never trusted from the
 *  browser) or an active promo-code grant (the user's own promoRedemptions document). */
export function PremiumProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [value, setValue] = useState<PremiumValue>({ status: 'loading', premium: false });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setValue({ status: 'loading', premium: false });
    (async () => {
      let promo = false;
      try {
        const snap = await getDoc(doc(db, 'promoRedemptions', user.uid));
        const d = snap.data();
        if (d) {
          const until = (d.freeUntil as { toDate?: () => Date } | null)?.toDate?.();
          promo = d.grantsPro === true || (!!until && until.getTime() > Date.now());
        }
      } catch { /* no promo */ }
      let sub: boolean | null = null;
      try {
        const res = await fetch(`${API_BASE}/v1/premium`, { headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
        if (res.ok) sub = ((await res.json()) as { premium: boolean }).premium;
      } catch { /* leave null */ }
      if (cancelled) return;
      if (promo || sub) setValue({ status: 'ready', premium: true });
      else setValue({ status: sub === null ? 'unavailable' : 'ready', premium: false });
    })();
    return () => { cancelled = true; };
  }, [user]);

  const memo = useMemo(() => value, [value]);
  return <Ctx.Provider value={memo}>{children}</Ctx.Provider>;
}

export const usePremium = (): PremiumValue => useContext(Ctx);

/** Wraps a Premium-only feature. Shows a short upgrade card instead of the content. */
export function PremiumGate({ feature, children }: { feature: string; children: ReactNode }) {
  const { status, premium } = usePremium();
  if (premium) return <>{children}</>;
  if (status === 'loading') return <div className="skeleton" aria-busy="true" />;
  return (
    <div className="card" style={{ textAlign: 'center', padding: 32 }}>
      <div style={{ fontSize: 34 }}>⭐</div>
      <h2 style={{ justifyContent: 'center', marginTop: 8 }}>{feature} is a Premium feature</h2>
      <p className="sub" style={{ maxWidth: 440, margin: '0 auto' }}>
        {status === 'unavailable'
          ? "We couldn't check your Premium status just now. Refresh in a moment."
          : 'Premium is one plan across the phone app and the website. Upgrade in the mobile app and it unlocks here too.'}
      </p>
      {status === 'ready' && (
        <div className="toolbar" style={{ justifyContent: 'center', marginTop: 16, marginBottom: 0 }}>
          <a className="btn primary" href={APP_STORE} rel="noopener">App Store</a>
          <a className="btn" href={PLAY_STORE} rel="noopener">Google Play</a>
        </div>
      )}
    </div>
  );
}
