import { doc, setDoc } from 'firebase/firestore';
import { useMemo, useState, type FormEvent } from 'react';
import { ALL_CATEGORIES, categoryIcon } from '@app/constants/categories';
import { formatLocalDate, calendarDateKey } from '@app/lib/calendarDate';
import { CURRENCIES, convertEntryToUsd, convertUsdToEntry, currencyDecimals, type CurrencyCode } from '@app/lib/currency';
import type { Receipt } from '@app/types';
import { useAuth } from '../auth';
import { Modal, NO_REPEAT, RecurringFields, type RecurringState } from '../components';
import { useData } from '../data';
import { db } from '../firebase';
import { buildSchedule } from '../lib/schedule';
import { remapSelfIds, remapSelfValues } from '../lib/splitSelf';

type Method = 'equal' | 'percent' | 'amount' | 'shares';
interface Item { key: string; name: string; amount: string; category: string }

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function ReceiptForm({ receipt, draft, onClose }: { receipt?: Receipt; draft?: Partial<Receipt>; onClose: () => void }) {
  const { user } = useAuth();
  const { householdId, members, customCategories, currency: displayCurrency } = useData();
  // `draft` pre-fills a NEW receipt (for example from an AI scan); `receipt` edits an existing one.
  const src = (receipt ?? draft) as Receipt | undefined;
  const entryCurrency: CurrencyCode = src?.originalCurrency ?? displayCurrency;
  const [currency, setCurrency] = useState<CurrencyCode>(entryCurrency);
  const dec = currencyDecimals(currency);
  const toEntry = (usd: number | undefined) => (usd == null ? '' : convertUsdToEntry(usd, currency).toFixed(dec));

  const allCategories = useMemo(() => [...(ALL_CATEGORIES as string[]), ...customCategories.map((c) => c.name)], [customCategories]);
  const [store, setStore] = useState(src?.storeName ?? '');
  const [date, setDate] = useState(src?.date ? calendarDateKey(src.date) ?? formatLocalDate(new Date()) : formatLocalDate(new Date()));
  const [total, setTotal] = useState(toEntry(src?.totalAmount));
  const [tax, setTax] = useState(toEntry(src?.taxAmount));
  const [tags, setTags] = useState<string[]>(src?.categoryTags?.length ? src.categoryTags : src?.category ? [src.category] : ['Groceries']);
  const [items, setItems] = useState<Item[]>((src?.lineItems ?? []).map((it) => ({ key: it.id, name: it.name, amount: toEntry(it.amount), category: (it.category as string) || src?.category || 'Other' })));
  const [notes, setNotes] = useState(src?.notes ?? '');
  const [paidBy, setPaidBy] = useState(receipt?.paidBy ?? user?.uid ?? '');
  const [splitOn, setSplitOn] = useState(Boolean(receipt?.split?.enabled));
  const [method, setMethod] = useState<Method>(receipt?.split?.method ?? 'equal');
  const [people, setPeople] = useState<string[]>(receipt?.split?.participantIds ? remapSelfIds(receipt.split.participantIds, user?.uid) : members.map((m) => m.uid));
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(remapSelfValues(receipt?.split?.values ?? {}, user?.uid)).map(([k, v]) => [k, String(v)])),
  );
  const [repeat, setRepeat] = useState<RecurringState>(receipt?.recurring ? { enabled: true, frequency: receipt.recurring.frequency, months: '' } : NO_REPEAT);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const itemsSum = items.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const nameOf = (uid: string) => members.find((m) => m.uid === uid)?.name ?? 'Member';
  const toggleTag = (t: string) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const togglePerson = (uid: string) => setPeople((cur) => (cur.includes(uid) ? cur.filter((x) => x !== uid) : [...cur, uid]));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!householdId || !user) return;
    const totalN = Number(total);
    if (!store.trim()) return setErr('Enter the store name.');
    if (!(totalN > 0)) return setErr('Enter a total greater than zero.');
    if (tags.length === 0) return setErr('Pick at least one category.');
    if (items.some((i) => !i.name.trim() || !(Number(i.amount) !== 0 && Number.isFinite(Number(i.amount))))) return setErr('Each item needs a name and an amount.');
    let split: Receipt['split'] | null = null;
    if (splitOn) {
      if (people.length < 2) return setErr('Choose at least two people to split with.');
      const v: Record<string, number> = {};
      if (method !== 'equal') for (const p of people) v[p] = Number(vals[p]) || 0;
      if (method === 'percent' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - 100) > 0.01) return setErr('Percentages must add up to 100.');
      if (method === 'amount' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - totalN) > 0.01) return setErr('Amounts must add up to the total.');
      if (method === 'shares' && Object.values(v).every((x) => x <= 0)) return setErr('Give at least one person a share.');
      // Amounts are typed in the entry currency; stored values are USD like the rest of the receipt.
      const stored = method === 'amount' ? Object.fromEntries(Object.entries(v).map(([k, n]) => [k, round2(convertEntryToUsd(n, currency))])) : v;
      split = { enabled: true, method, participantIds: people, ...(method === 'equal' ? {} : { values: stored }) };
    }
    const repeating = buildSchedule(repeat.enabled, repeat.frequency, date, parseInt(repeat.months, 10) || 0, receipt?.recurring?.endDate);
    const now = new Date().toISOString();
    const id = receipt?.id ?? crypto.randomUUID();
    const [y, m, d] = date.split('-').map(Number);
    // merge: keeps fields this form does not edit (rawText, imageUri, photoUrl, ...).
    setBusy(true);
    try {
      await setDoc(
        doc(db, 'households', householdId, 'receipts', id),
        {
          id,
          storeName: store.trim(),
          date: new Date(y, m - 1, d, 12).toISOString(),
          totalAmount: round2(convertEntryToUsd(totalN, currency)),
          taxAmount: tax && Number(tax) > 0 ? round2(convertEntryToUsd(Number(tax), currency)) : null,
          category: tags[0],
          categoryTags: tags,
          notes: notes.trim() || null,
          split,
          recurring: repeating,
          paidBy: paidBy || user.uid,
          originalCurrency: currency,
          lineItems: items.map((i) => ({ id: i.key, name: i.name.trim(), amount: round2(convertEntryToUsd(Number(i.amount), currency)), category: i.category, splitWith: [] })),
          ...(receipt ? {} : { createdBy: user.uid, isRecurringOccurrence: false, rawText: null, imageUri: null, photoUrl: null, subtotalAmount: null, createdAt: now }),
          updatedAt: now,
        },
        { merge: true },
      );
      onClose();
    } catch {
      setErr('Could not save. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <Modal title={receipt ? 'Edit receipt' : 'Add receipt'} onClose={onClose} wide>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <div className="form-grid">
          <label>Store<input type="text" value={store} onChange={(e) => setStore(e.target.value)} autoFocus /></label>
          <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label>Currency<select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Total<input type="number" step="0.01" min="0" value={total} onChange={(e) => setTotal(e.target.value)} /></label>
          <label>Tax (optional)<input type="number" step="0.01" min="0" value={tax} onChange={(e) => setTax(e.target.value)} /></label>
          <label>Paid by<select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>{members.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}</select></label>
        </div>

        <div><div className="label-sm">Categories</div>
          <div className="chips">{allCategories.map((c) => <button type="button" key={c} className={`chip-btn${tags.includes(c) ? ' on' : ''}`} onClick={() => toggleTag(c)}>{categoryIcon(c)} {c}</button>)}</div></div>

        <div>
          <div className="row-between"><div className="label-sm">Items</div>
            <button type="button" className="btn sm" onClick={() => setItems((cur) => [...cur, { key: crypto.randomUUID(), name: '', amount: '', category: tags[0] ?? 'Other' }])}>+ Add item</button></div>
          {items.map((it, idx) => (
            <div className="item-row" key={it.key}>
              <input type="text" placeholder="Item" value={it.name} onChange={(e) => setItems((c) => c.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))} aria-label="Item name" />
              <input type="number" step="0.01" placeholder="Amount" value={it.amount} onChange={(e) => setItems((c) => c.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))} aria-label="Item amount" />
              <select value={it.category} onChange={(e) => setItems((c) => c.map((x, i) => (i === idx ? { ...x, category: e.target.value } : x)))} aria-label="Item category">{allCategories.map((c) => <option key={c}>{c}</option>)}</select>
              <button type="button" className="btn sm danger" onClick={() => setItems((c) => c.filter((_, i) => i !== idx))} aria-label="Remove item">✕</button>
            </div>
          ))}
          {items.length > 0 && Number(total) > 0 && Math.abs(itemsSum + (Number(tax) || 0) - Number(total)) > 0.02 && (
            <p className="watch" style={{ fontSize: 13, marginTop: 6 }}>Items{tax ? ' plus tax' : ''} add up to {(itemsSum + (Number(tax) || 0)).toFixed(dec)}, not the total {Number(total).toFixed(dec)}.</p>
          )}
        </div>

        <div className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
          <label className="switch-row"><span>Split this expense</span><input type="checkbox" checked={splitOn} onChange={(e) => setSplitOn(e.target.checked)} /></label>
          {splitOn && (
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              <select value={method} onChange={(e) => setMethod(e.target.value as Method)} aria-label="Split method">
                <option value="equal">Equally</option><option value="percent">By percentage</option><option value="amount">By exact amount</option><option value="shares">By shares</option>
              </select>
              {members.map((m) => (
                <div className="row-between" key={m.uid}>
                  <label className="switch-row" style={{ justifyContent: 'flex-start', gap: 10 }}><input type="checkbox" checked={people.includes(m.uid)} onChange={() => togglePerson(m.uid)} />{m.name}</label>
                  {method !== 'equal' && people.includes(m.uid) && (
                    <input type="number" step="0.01" min="0" style={{ width: 120 }} value={vals[m.uid] ?? ''} placeholder={method === 'percent' ? '%' : method === 'shares' ? 'shares' : currency}
                      onChange={(e) => setVals((v) => ({ ...v, [m.uid]: e.target.value }))} aria-label={`${nameOf(m.uid)} ${method}`} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <RecurringFields value={repeat} onChange={setRepeat} editing={Boolean(receipt?.recurring)} />
        <label>Notes<input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row-between"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{receipt ? 'Save changes' : 'Save receipt'}</button></div>
      </form>
    </Modal>
  );
}
