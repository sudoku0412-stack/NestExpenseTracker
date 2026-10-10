import { useMemo, useState } from 'react';
import type { Income } from '@app/types';
import { useData } from '../data';
import { dateLabel, inMonth } from '../lib/stats';
import IncomeForm from '../forms/IncomeForm';
import { deleteIncome } from '../lib/writes';
import { useMoney } from '../money';
import { INCOME_COLORS, INCOME_LABELS } from '../palette';
import { MonthPicker, usePeriod } from '../period';

export default function Incomes() {
  const { incomes, householdId, members, memberName } = useData();
  const { year, month, label } = usePeriod();
  const fmt = useMoney();
  const [form, setForm] = useState<{ income?: Income } | null>(null);
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
        <div className="row-between"><MonthPicker /><button className="btn primary" onClick={() => setForm({})}>+ Add income</button></div>
      </div>
      <div className="toolbar">
        <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
          <option value="all">Everyone</option>
          {members.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}
        </select>
      </div>
      <div className="card">
        {rows.length === 0 ? <div className="empty">No income for {label}.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th>Source</th><th>Type</th><th className="hide-sm">Earned by</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td>{dateLabel(i.date)}</td>
                  <td>{i.sourceName}{i.recurring || i.isRecurringOccurrence ? ' 🔁' : ''}</td>
                  <td><span className="chip" style={{ background: `${INCOME_COLORS[i.category] ?? '#8e96aa'}22`, color: 'var(--ink)' }}>{INCOME_LABELS[i.category] ?? i.category}</span></td>
                  <td className="muted hide-sm">{memberName(i.earnedBy)}</td>
                  <td className="num">{fmt(i.amountUsd)}</td>
                  <td className="num"><button className="btn sm" style={{ marginRight: 6 }} onClick={() => setForm({ income: i })}>Edit</button><button className="btn sm danger" onClick={async () => {
                    if (householdId && confirm(`Delete "${i.sourceName}"? This also removes it on every device.`)) await deleteIncome(householdId, i.id);
                  }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      {form && <IncomeForm income={form.income} onClose={() => setForm(null)} />}
    </>
  );
}

