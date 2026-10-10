import { useState, type FormEvent } from 'react';
import { convertEntryToUsd, convertFromUsd, currencyDecimals } from '@app/lib/currency';
import type { SavingsGoal } from '@app/types';
import { useData } from '../data';
import { deleteGoal, saveGoal } from '../lib/writes';
import { useMoney } from '../money';

export default function Goals() {
  const { goals, householdId, currency } = useData();
  const fmt = useMoney();
  const [form, setForm] = useState<{ goal?: SavingsGoal } | null>(null);
  const [adjust, setAdjust] = useState<Record<string, string>>({});
  const totalTarget = goals.reduce((s, g) => s + g.targetUsd, 0);
  const totalSaved = goals.reduce((s, g) => s + g.allocatedUsd, 0);

  async function move(g: SavingsGoal, sign: 1 | -1) {
    const n = Number(adjust[g.id]);
    if (!householdId || !(n > 0)) return;
    await saveGoal(householdId, { ...g, allocatedUsd: g.allocatedUsd + sign * convertEntryToUsd(n, currency) });
    setAdjust((a) => ({ ...a, [g.id]: '' }));
  }

  return (
    <>
      <div className="head">
        <div><h1>Savings goals</h1><p className="sub">{goals.length ? `${fmt(totalSaved)} saved of ${fmt(totalTarget)}` : 'Set money aside for what matters'}</p></div>
        <button className="btn primary" onClick={() => setForm({})}>+ New goal</button>
      </div>
      {goals.length === 0 ? <div className="card empty">No goals yet. Create one, such as "Holiday" or "Emergency fund".</div> : (
        <div className="grid cols-2">
          {[...goals].sort((a, b) => a.name.localeCompare(b.name)).map((g) => {
            const ratio = g.targetUsd > 0 ? Math.min(g.allocatedUsd / g.targetUsd, 1) : 0;
            const done = g.targetUsd > 0 && g.allocatedUsd >= g.targetUsd;
            return (
              <div className="card" key={g.id}>
                <div className="row-between"><h2 style={{ margin: 0 }}>{done ? '🎉 ' : '🎯 '}{g.name}</h2><span className={done ? 'ok' : 'muted'} style={{ fontWeight: 700 }}>{Math.round(ratio * 100)}%</span></div>
                <div className="meter" style={{ height: 12, marginTop: 12 }}><span style={{ width: `${ratio * 100}%`, background: done ? 'var(--brand)' : 'var(--blue)' }} /></div>
                <p className="sub" style={{ marginTop: 8 }}>{fmt(g.allocatedUsd)} of {fmt(g.targetUsd)}{!done && g.targetUsd > g.allocatedUsd ? ` · ${fmt(g.targetUsd - g.allocatedUsd)} to go` : ''}</p>
                {g.notes && <p style={{ marginTop: 6, fontSize: 14 }}>{g.notes}</p>}
                <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
                  <input type="number" step="0.01" min="0" placeholder={`Amount (${currency})`} value={adjust[g.id] ?? ''} onChange={(e) => setAdjust((a) => ({ ...a, [g.id]: e.target.value }))} aria-label={`Amount for ${g.name}`} />
                  <button className="btn sm primary" onClick={() => void move(g, 1)}>Add</button>
                  <button className="btn sm" onClick={() => void move(g, -1)}>Take out</button>
                </div>
                <div className="row-between" style={{ marginTop: 12 }}>
                  <button className="link" onClick={() => setForm({ goal: g })}>Edit</button>
                  <button className="link over" onClick={() => { if (householdId && confirm(`Delete "${g.name}"?`)) void deleteGoal(householdId, g.id); }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {form && <GoalForm goal={form.goal} onClose={() => setForm(null)} onSave={async (v) => {
        if (!householdId) return;
        await saveGoal(householdId, { id: form.goal?.id, createdAt: form.goal?.createdAt, allocatedUsd: form.goal?.allocatedUsd ?? 0, ...v });
        setForm(null);
      }} />}
    </>
  );
}

function GoalForm({ goal, onClose, onSave }: { goal?: SavingsGoal; onClose: () => void; onSave: (v: { name: string; targetUsd: number; notes: string }) => Promise<void> }) {
  const { currency } = useData();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? convertFromUsd(goal.targetUsd, currency).toFixed(currencyDecimals(currency)) : '');
  const [notes, setNotes] = useState(goal?.notes ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErr('Give the goal a name.');
    if (!(Number(target) > 0)) return setErr('Enter a target amount greater than zero.');
    setBusy(true);
    try { await onSave({ name, targetUsd: convertEntryToUsd(Number(target), currency), notes }); } catch { setErr('Could not save. Try again.'); setBusy(false); }
  }
  return (
    <div className="drawer-bg" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label="Savings goal">
        <h1>{goal ? 'Edit goal' : 'New goal'}</h1>
        <label>Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Holiday" /></label>
        <label>Target ({currency})<input type="number" step="0.01" min="0" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <label>Notes (optional)<input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row-between"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div>
      </form>
    </div>
  );
}
