import { useMemo, useState } from 'react';
import { ALL_CATEGORIES, categoryIcon } from '@app/constants/categories';
import type { Receipt } from '@app/types';
import { useData } from '../data';
import { dateLabel, inMonth } from '../lib/stats';
import ReceiptForm from '../forms/ReceiptForm';
import { deleteReceipt } from '../lib/writes';
import { useMoney } from '../money';
import { MonthPicker, usePeriod } from '../period';

export default function Receipts() {
  const { receipts, householdId, customCategories, memberName } = useData();
  const { year, month, label } = usePeriod();
  const fmt = useMoney();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [scope, setScope] = useState<'month' | 'all'>('month');
  const [open, setOpen] = useState<Receipt | null>(null);
  const [form, setForm] = useState<{ receipt?: Receipt } | null>(null);

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
          <button className="btn primary" onClick={() => setForm({})}>+ Add receipt</button>
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
            <div className="row-between"><h1>{open.storeName}</h1><span style={{ display: 'flex', gap: 8 }}><button className="btn sm" onClick={() => { setForm({ receipt: open }); setOpen(null); }}>Edit</button><button className="btn sm" onClick={() => setOpen(null)}>Close</button></span></div>
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

      {form && <ReceiptForm receipt={form.receipt} onClose={() => setForm(null)} />}
    </>
  );
}

