import { useMemo, useState, type FormEvent } from 'react';
import { ALL_CATEGORIES, categoryIcon } from '@app/constants/categories';
import { formatLocalDate } from '@app/lib/calendarDate';
import type { Receipt } from '@app/types';
import { useAuth } from '../auth';
import { useData } from '../data';
import { dateLabel, inMonth } from '../lib/stats';
import { addReceipt, deleteReceipt } from '../lib/writes';
import { useMoney } from '../money';
import { MonthPicker, usePeriod } from '../period';

export default function Receipts() {
  const { receipts, householdId, customCategories, currency, memberName } = useData();
  const { user } = useAuth();
  const { year, month, label } = usePeriod();
  const fmt = useMoney();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [scope, setScope] = useState<'month' | 'all'>('month');
  const [open, setOpen] = useState<Receipt | null>(null);
  const [adding, setAdding] = useState(false);

  const categories = useMemo(() => [...ALL_CATEGORIES as string[], ...customCategories.map((c) => c.name)], [customCategories]);
  const rows = useMemo(() => {
    const base = scope === 'month' ? inMonth(receipts, year, month) : receipts;
    const needle = q.trim().toLowerCase();
    return base
      .filter((r) => (cat === 'all' || r.category === cat) && (!needle || r.storeName.toLowerCase().includes(needle) || (r.notes ?? '').toLowerCase().includes(needle)))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [receipts, scope, year, month, q, cat]);
  const total = rows.reduce((s, r) => s + r.totalAmount, 0);

  return (
    <>
      <div className="head">
        <div><h1>Receipts</h1><p className="sub">{rows.length} {rows.length === 1 ? 'receipt' : 'receipts'} · {fmt(total)}{scope === 'month' ? ` · ${label}` : ''}</p></div>
        <div className="row-between">
          {scope === 'month' && <MonthPicker />}
          <button className="btn primary" onClick={() => setAdding(true)}>+ Add receipt</button>
        </div>
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Search store or notes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search receipts" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value as 'month' | 'all')} aria-label="Period">
          <option value="month">This month</option><option value="all">All time</option>
        </select>
      </div>
      <div className="card">
        {rows.length === 0 ? <div className="empty">No receipts match.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Store</th><th>Category</th><th className="hide-sm">Added by</th><th className="num">Total</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="click" onClick={() => setOpen(r)}>
                  <td>{dateLabel(r.date)}</td>
                  <td>{r.storeName}{r.recurring || r.isRecurringOccurrence ? ' 🔁' : ''}</td>
                  <td><span className="chip">{categoryIcon(r.category)} {r.category}</span></td>
                  <td className="muted hide-sm">{memberName(r.createdBy)}</td>
                  <td className="num">{fmt(r.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {open && (
        <div className="drawer-bg" onClick={() => setOpen(null)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Receipt details">
            <div className="row-between"><h1>{open.storeName}</h1><button className="btn sm" onClick={() => setOpen(null)}>Close</button></div>
            <p className="sub">{dateLabel(open.date)} · {open.category} · added by {memberName(open.createdBy)}</p>
            <div className="card kpi"><div className="label">Total</div><div className="value">{fmt(open.totalAmount)}</div>
              {open.taxAmount ? <div className="note">Includes {fmt(open.taxAmount)} tax</div> : null}</div>
            {open.photoUrl && <img src={open.photoUrl} alt="Receipt" style={{ width: '100%', borderRadius: 16 }} />}
            {open.lineItems && open.lineItems.length > 0 && (
              <div className="card"><h2>Items</h2>
                <table><tbody>{open.lineItems.map((it) => <tr key={it.id}><td>{it.name}<div className="muted" style={{ fontSize: 12 }}>{it.category ?? open.category}</div></td><td className="num">{fmt(it.amount)}</td></tr>)}</tbody></table></div>
            )}
            {open.notes && <div className="card"><h2>Notes</h2><p>{open.notes}</p></div>}
            <button className="btn danger" onClick={async () => {
              if (!householdId || !confirm(`Delete the ${open.storeName} receipt? This also removes it on every device.`)) return;
              await deleteReceipt(householdId, open.id);
              setOpen(null);
            }}>Delete receipt</button>
          </aside>
        </div>
      )}

      {adding && (
        <AddReceipt categories={categories} onClose={() => setAdding(false)} onSave={async (v) => {
          if (!householdId || !user) return;
          await addReceipt({ householdId, uid: user.uid, currency, ...v });
          setAdding(false);
        }} />
      )}
    </>
  );
}

function AddReceipt({ categories, onClose, onSave }: {
  categories: string[];
  onClose: () => void;
  onSave: (v: { storeName: string; date: string; amount: number; category: string; notes: string }) => Promise<void>;
}) {
  const { currency } = useData();
  const [store, setStore] = useState('');
  const [date, setDate] = useState(formatLocalDate(new Date()));
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Groceries');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!store.trim()) return setErr('Enter the store name.');
    if (!(n > 0)) return setErr('Enter an amount greater than zero.');
    setBusy(true);
    try {
      await onSave({ storeName: store, date, amount: n, category, notes });
    } catch {
      setErr('Could not save. Check your connection and try again.');
      setBusy(false);
    }
  }
  return (
    <div className="drawer-bg" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label="Add receipt">
        <h1>Add receipt</h1>
        <label>Store<input type="text" value={store} onChange={(e) => setStore(e.target.value)} autoFocus /></label>
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>Total ({currency})<input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label>Notes (optional)<input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row-between"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div>
      </form>
    </div>
  );
}
