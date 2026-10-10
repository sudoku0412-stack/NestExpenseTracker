import { useState, type FormEvent } from 'react';
import { authMessage, useAuth } from '../auth';

const APP_STORE = 'https://apps.apple.com/us/app/nestexpensetracker/id6797353891';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.kaushikmajumder.receiptscanner';
const LEGAL = 'https://nestexpensetracker.legal.craftloop.ca';

const FEATURES = [
  ['📸', 'Scan receipts in seconds', 'Snap a receipt and the app reads the store, date, total and line items.'],
  ['🎯', 'Budgets that talk back', 'See what is spent and what is left in every category, on track, watch or over.'],
  ['💼', 'Earnings and investments', 'Income by person and holdings by kind, in one clear picture.'],
  ['🏠', 'Built for households', 'Share receipts, budgets and splits with the people you live with.'],
] as const;

export default function Login() {
  const { signIn, signUp, google, apple, reset } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ text: authMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => (mode === 'in' ? signIn(email, password) : signUp(email, password)));
  };

  return (
    <div className="landing">
      <div className="backdrop" aria-hidden="true"><i className="blob a" /><i className="blob b" /></div>
      <header className="lp-top">
        <div className="lp-brand"><img src="/icon.png" alt="" /><span>NestExpenseTracker<span className="dotmark">.</span></span></div>
        <span className="lp-by">A <b>Craftloop</b> product</span>
      </header>

      <main className="lp-main">
        <section className="lp-copy">
          <span className="pill"><i />Now on web, iOS and Android</span>
          <h1>Scan receipts. <em>Track every dollar.</em></h1>
          <p className="lede">Your household's spending, budgets, earnings and investments, all in one place. Sign in with your NestExpenseTracker account to see everything on a bigger screen.</p>
          <ul className="lp-feats">
            {FEATURES.map(([icon, title, body]) => (
              <li key={title}><span className="ico" aria-hidden="true">{icon}</span><div><b>{title}</b><p>{body}</p></div></li>
            ))}
          </ul>
          <div className="lp-stores">
            <a className="store" href={APP_STORE} rel="noopener"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.37 1.43c0 1.14-.46 2.22-1.2 3-.8.86-2.1 1.52-3.16 1.43-.13-1.1.42-2.27 1.14-3 .8-.84 2.17-1.47 3.22-1.43zM20.5 17.1c-.55 1.27-.82 1.84-1.53 2.96-.99 1.57-2.39 3.52-4.12 3.54-1.54.02-1.94-1-4.03-.99-2.09.01-2.53 1.01-4.07.99-1.73-.02-3.05-1.78-4.04-3.35C.01 16.07-.28 10.8 1.43 8.17c1.21-1.87 3.12-2.97 4.92-2.97 1.83 0 2.98 1 4.49 1 1.47 0 2.36-1 4.48-1 1.6 0 3.3.87 4.51 2.38-3.96 2.17-3.32 7.83.67 9.52z" /></svg><span><small>Download on the</small><b>App Store</b></span></a>
            <a className="store" href={PLAY_STORE} rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#00d7fe" d="M3.6 1.6c-.3.3-.5.8-.5 1.4v18c0 .6.2 1.1.5 1.4l.1.1 10.1-10.1v-.2L3.7 1.5z" /><path fill="#ffce00" d="M17.2 15.5l-3.4-3.4v-.2l3.4-3.4.1.1 4 2.3c1.1.6 1.1 1.7 0 2.4l-4 2.3z" /><path fill="#f43a50" d="M17.3 15.4L13.8 12 3.6 22.2c.4.4 1 .4 1.7.1l12-6.9" /><path fill="#00f076" d="M17.3 8.6l-12-6.8c-.7-.4-1.3-.3-1.7.1L13.8 12z" /></svg><span><small>Get it on</small><b>Google Play</b></span></a>
          </div>
        </section>

        <section className="lp-card card auth" aria-label="Sign in">
          <h2>{mode === 'in' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="sub">{mode === 'in' ? 'Sign in to open your dashboard.' : 'Use the same account on the web and on your phone.'}</p>
          <form onSubmit={submit}>
            <input type="email" placeholder="Email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <input type="password" placeholder="Password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
            {msg && <div className={msg.ok ? 'ok' : 'err'} role="alert">{msg.text}</div>}
            <button className="btn primary big" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Sign up'}</button>
            <div className="or"><span>or</span></div>
            <button type="button" className="btn big" disabled={busy} onClick={() => void run(google)}>Continue with Google</button>
            <button type="button" className="btn big" disabled={busy} onClick={() => void run(apple)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.37 1.43c0 1.14-.46 2.22-1.2 3-.8.86-2.1 1.52-3.16 1.43-.13-1.1.42-2.27 1.14-3 .8-.84 2.17-1.47 3.22-1.43zM20.5 17.1c-.55 1.27-.82 1.84-1.53 2.96-.99 1.57-2.39 3.52-4.12 3.54-1.54.02-1.94-1-4.03-.99-2.09.01-2.53 1.01-4.07.99-1.73-.02-3.05-1.78-4.04-3.35C.01 16.07-.28 10.8 1.43 8.17c1.21-1.87 3.12-2.97 4.92-2.97 1.83 0 2.98 1 4.49 1 1.47 0 2.36-1 4.48-1 1.6 0 3.3.87 4.51 2.38-3.96 2.17-3.32 7.83.67 9.52z" /></svg>
              Continue with Apple
            </button>
          </form>
          <div className="row-between" style={{ marginTop: 16, fontSize: 14 }}>
            <button className="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }}>
              {mode === 'in' ? 'Create an account' : 'I already have an account'}
            </button>
            {mode === 'in' && (
              <button className="link" onClick={() => void run(async () => { await reset(email); setMsg({ text: 'Password reset email sent.', ok: true }); })}>Forgot password?</button>
            )}
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div>
          <div className="lp-brand sm"><img src="/icon.png" alt="" /><span>NestExpenseTracker<span className="dotmark">.</span></span></div>
          <p>A <b>Craftloop</b> product</p>
        </div>
        <div className="lp-links"><a href={`${LEGAL}/privacy`}>Privacy Policy</a><a href={`${LEGAL}/terms`}>Terms of Service</a></div>
        <span>© {new Date().getFullYear()} Craftloop. All rights reserved.</span>
      </footer>
    </div>
  );
}
