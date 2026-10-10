import { arrayRemove, arrayUnion, doc, setDoc } from 'firebase/firestore';
import { useState, type FormEvent } from 'react';
import { ALL_CATEGORIES } from '@app/constants/categories';
import { CURRENCIES, isPremiumCurrency, type CurrencyCode } from '@app/lib/currency';
import { useAuth } from '../auth';
import { useData } from '../data';
import { db } from '../firebase';
import { setCategoryBudget } from '../lib/writes';
import { APP_STORE, PLAY_STORE, PremiumGate, usePremium } from '../premium';

// Same limits and colour cycle as lib/customCategories.ts in the mobile app.
const MAX_CUSTOM = 20;
const MAX_NAME = 24;
const COLORS = ['#D6336C', '#0CA678', '#F08C00', '#7048E8', '#1C7ED6', '#E8590C', '#099268', '#AE3EC9'];

export default function Settings() {
  const { user, logout } = useAuth();
  const { currency, setCurrency, customCategories, householdId, members } = useData();
  const { premium, status } = usePremium();
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!householdId) return;
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean) return setErr('Enter a name.');
    if (clean.length > MAX_NAME) return setErr(`Keep it to ${MAX_NAME} characters or fewer.`);
    if (customCategories.length >= MAX_CUSTOM) return setErr(`You can have up to ${MAX_CUSTOM} custom categories.`);
    const taken = new Set([...(ALL_CATEGORIES as string[]), ...customCategories.map((c) => c.name)].map((n) => n.toLowerCase()));
    if (taken.has(clean.toLowerCase())) return setErr('A category with that name already exists.');
    setErr('');
    setBusy(true);
    try {
      // arrayUnion so two people adding at once never overwrite each other (same as the phone).
      await setDoc(doc(db, 'households', householdId), { customCategories: arrayUnion({ name: clean, color: COLORS[customCategories.length % COLORS.length] }) }, { merge: true });
      setName('');
    } catch {
      setErr('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: { name: string; color?: string }) {
    if (!householdId || !confirm(`Remove "${c.name}"? Receipts keep the name, and its budget is cleared.`)) return;
    await setDoc(doc(db, 'households', householdId), { customCategories: arrayRemove(c) }, { merge: true });
    await setCategoryBudget(householdId, c.name, 0);
  }

  return (
    <>
      <div className="head"><div><h1>Settings</h1><p className="sub">{user?.email}</p></div></div>
      <div className="grid cols-2">
        <div className="card">
          <h2>Display currency</h2>
          <p className="sub" style={{ marginBottom: 10 }}>Amounts are stored in US dollars and shown in the currency you pick. This choice is for the website only.</p>
          <select value={currency} onChange={(e) => { const c = e.target.value as CurrencyCode; if (isPremiumCurrency(c) && !premium) { alert('That currency is part of Premium. Upgrade in the mobile app to use it here.'); return; } setCurrency(c); }} aria-label="Display currency">
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}{isPremiumCurrency(c) && !premium ? ' 🔒' : ''}</option>)}
          </select>
        </div>
        <div className="card">
          <h2>Your plan</h2>
          <div className="row-between"><span style={{ fontWeight: 700 }}>{premium ? '⭐ Premium' : status === 'loading' ? 'Checking…' : status === 'unavailable' ? 'Could not check' : 'Free'}</span></div>
          {!premium && status === 'ready' && (<><p className="sub" style={{ margin: '8px 0 12px' }}>Premium adds custom categories, investments, AI receipt scanning, more currencies and PDF export. Upgrade in the mobile app.</p>
            <div className="toolbar" style={{ marginBottom: 0 }}><a className="btn sm" href={APP_STORE} rel="noopener">App Store</a><a className="btn sm" href={PLAY_STORE} rel="noopener">Google Play</a></div></>)}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <PremiumGate feature="Custom categories">
          <div className="card">
            <h2>Custom categories <small>{customCategories.length} of {MAX_CUSTOM}</small></h2>
            <p className="sub" style={{ marginBottom: 12 }}>Shared with everyone in your household, and usable for receipt items and budgets.</p>
            <form className="toolbar" onSubmit={add}>
              <input type="text" placeholder="e.g. Pets, Gym, Kids" value={name} maxLength={MAX_NAME + 8} onChange={(e) => setName(e.target.value)} aria-label="New category name" />
              <button className="btn primary" disabled={busy}>Add category</button>
            </form>
            {err && <div className="err" role="alert" style={{ marginBottom: 10 }}>{err}</div>}
            {customCategories.length === 0 ? <div className="empty">No custom categories yet.</div> : (
              <div className="chips">{customCategories.map((c) => (
                <span key={c.name} className="chip-btn on" style={{ borderColor: c.color, background: `${c.color}22`, color: 'var(--ink)', cursor: 'default' }}>
                  <span className="dot" style={{ background: c.color }} />{c.name}
                  <button className="link over" style={{ marginLeft: 8 }} onClick={() => void remove(c)} aria-label={`Remove ${c.name}`}>✕</button></span>))}</div>
            )}
          </div>
        </PremiumGate>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Household <small>{members.length} {members.length === 1 ? 'member' : 'members'}</small></h2>
        <table><tbody>{members.map((m) => <tr key={m.uid}><td>{m.name}{m.uid === user?.uid ? ' (you)' : ''}</td><td className="muted">{m.email}</td></tr>)}</tbody></table>
        <p className="sub" style={{ marginTop: 10 }}>Invite people and manage households in the mobile app.</p>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Account</h2>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn" onClick={() => void logout()}>Sign out</button>
        </div>
        <p className="sub" style={{ marginTop: 10 }}>To delete your account and data, use Settings → Delete account in the mobile app.</p>
      </div>
    </>
  );
}
