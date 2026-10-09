import { useState, type FormEvent } from 'react';
import { authMessage, useAuth } from '../auth';

export default function Login() {
  const { signIn, signUp, google, reset } = useAuth();
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
    <div className="center">
      <div className="card auth">
        <div className="logo" style={{ padding: 0 }}><img src="/icon.png" alt="" />NestExpenseTracker</div>
        <h1 style={{ marginTop: 18 }}>{mode === 'in' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="sub">Use the same account as the mobile app to see your household's data.</p>
        <form onSubmit={submit}>
          <input type="email" placeholder="Email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" placeholder="Password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required value={password} onChange={(e) => setPassword(e.target.value)} />
          {msg && <div className={msg.ok ? 'ok' : 'err'} role="alert">{msg.text}</div>}
          <button className="btn primary" disabled={busy} style={{ justifyContent: 'center', height: 44 }}>{mode === 'in' ? 'Sign in' : 'Sign up'}</button>
          <button type="button" className="btn" disabled={busy} style={{ justifyContent: 'center', height: 44 }} onClick={() => void run(google)}>Continue with Google</button>
        </form>
        <div className="row-between" style={{ marginTop: 16, fontSize: 14 }}>
          <button className="link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }}>
            {mode === 'in' ? 'Create an account' : 'I already have an account'}
          </button>
          {mode === 'in' && (
            <button className="link" onClick={() => void run(async () => { await reset(email); setMsg({ text: 'Password reset email sent.', ok: true }); })}>Forgot password?</button>
          )}
        </div>
      </div>
    </div>
  );
}
