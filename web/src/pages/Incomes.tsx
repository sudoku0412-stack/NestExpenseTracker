import { useMemo, useState, type FormEvent } from 'react';
import { formatLocalDate } from '@app/lib/calendarDate';
import type { IncomeCategory } from '@app/types';
import { useAuth } from '../auth';
import { useData } from '../data';
import { dateLabel, inMonth } from '../lib/stats';
import { addIncome, deleteIncome } from '../lib/writes';
import { useMoney } from '../money';
import { INCOME_COLORS, INCOME_LABELS } from '../palette';
import { MonthPicker, usePeriod } from '../period';

const TYPES = Object.keys(INCOME_LABELS) as IncomeCategory[];

export default function Incomes() {
  const { incomes, householdId, members, currency, memberName } = useData();
  const { user } = useAuth();
  const { year, month, label } = usePeriod();
  const fmt = useMoney();
  const [adding, setAdding] = useState(false);
  const [person, setPerson] = useState('all');

  const rows = useMemo(
    () => inMonth(incomes, year, month).filter((i) => person === 'all' || i.earnedBy === person).sort((a, b) => b.date.localeCompare(a.date)),
    [incomes, year, month, person],
  );
  const total = rows.reduce((s, i) => s + i.amountUsd, 0);

  return (
    <>
      <div className="head">
        <div><h1>Income</h1><p className="sub">{rows.length} {rows.length === 1 ? 'entry' : 'entries'} · {fmt(total)} · {label}</p></div>
        <div className="row-between"><MonthPicker /><button className="btn primary" onClick={() => setAdding(true)}>+ Add income</button></div>
      </div>
      <div className="toolbar">
        <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
          <option value="all">Everyone</option>
          {members.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
        </select>
      </div>
      <div className="card">
        {rows.length === 0 ? <div className="empty">No income for {label}.</div> : (
          <table>
            <thead><tr><th>Date</th><th>Source</th><th>Type</th><th>Earned by</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td>{dateLabel(i.date)}</td>
                  <td>{i.sourceName}{i.recurring || i.isRecurringOccurrence ? ' 🔁' : ''}</td>
                  <td><span className="chip" style={{ background: `${INCOME_COLORS[i.category] ?? '#8e96aa'}22`, color: 'var(--ink)' }}>{INCOME_LABELS[i.category] ?? i.category}</span></td>
                  <td className="muted">{memberName(i.earnedBy)}</td>
                  <td className="num">{fmt(i.amountUsd)}</td>
                  <td className="num"><button className="btn sm danger" onClick={async () => {
                    if (householdId && confirm(`Delete "${i.sourceName}"? This also removes it on every device.`)) await deleteIncome(householdId, i.id);
                  }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {adding && <AddIncome onClose={() => setAdding(false)} onSave={async (v) => {
        if (!householdId || !user) return;
        await addIncome({ householdId, uid: user.uid, currency, ...v });
        setAdding(false);
      }} />}
    </>
  );
}

function AddIncome({ onClose, onSave }: {
  onClose: () => void;
  onSave: (v: { sourceName: string; date: string; amount: number; category: IncomeCategory; earnedBy: string; notes: string }) => Promise<void>;
}) {
  const { members, currency } = useData();
  const { user } = useAuth();
  const [source, setSource] = useState('');
  const [date, setDate] = useState(formatLocalDate(new Date()));
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<IncomeCategory>('Salary');
  const [earnedBy, setEarnedBy] = useState(user?.uid ?? members[0]?.uid ?? '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!source.trim()) return setErr('Enter where the money came from.');
    if (!(n > 0)) return setErr('Enter an amount greater than zero.');
    if (!earnedBy) return setErr('Choose who earned it.');
    setBusy(true);
    try {
      await onSave({ sourceName: source, date, amount: n, category, earnedBy, notes });
    } catch {
      setErr('Could not save. Check your connection and try again.');
      setBusy(false);
    }
  }
  return (
    <div className="drawer-bg" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label="Add income">
        <h1>Add income</h1>
        <label>Source<input type="text" value={source} onChange={(e) => setSource(e.target.value)} autoFocus placeholder="Acme payroll" /></label>
        <label>Type<select value={category} onChange={(e) => setCategory(e.target.value as IncomeCategory)}>{TYPES.map((t) => <option key={t} value={t}>{INCOME_LABELS[t]}</option>)}</select></label>
        <label>Earned by<select value={earnedBy} onChange={(e) => setEarnedBy(e.target.value)}>{members.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}</select></label>
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label>Amount ({currency})<input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Notes (optional)<input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row-between"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div>
      </form>
    </div>
  );
}
