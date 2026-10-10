import { useMemo, useState } from 'react';
import { ALL_CATEGORIES, categoryIcon } from '@app/constants/categories';
import { computeBudgetOverview } from '@app/lib/budgetOverview';
import { convertEntryToUsd, convertFromUsd, currencyDecimals } from '@app/lib/currency';
import { useData } from '../data';
import { computeBudgetSpend, inMonth } from '../lib/stats';
import { setBudgetAlertsEnabled, setCategoryBudget } from '../lib/writes';
import { useMoney } from '../money';
import { STATUS_CLASS, STATUS_COLOR } from '../palette';
import { MonthPicker, usePeriod } from '../period';

export default function Budgets() {
  const { receipts, budgets, budgetAlerts, customCategories, householdId, currency } = useData();
  const { year, month, label } = usePeriod();
  const fmt = useMoney();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newCat, setNewCat] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [error, setError] = useState('');

  const overview = useMemo(
    () => computeBudgetOverview(budgets, computeBudgetSpend(inMonth(receipts, year, month))),
    [budgets, receipts, year, month],
  );
  const unbudgeted = useMemo(
    () => [...(ALL_CATEGORIES as string[]), ...customCategories.map((c) => c.name)].filter((c) => !(budgets[c] > 0)),
    [budgets, customCategories],
  );
  const decimals = currencyDecimals(currency);
  const toDisplay = (usd: number) => convertFromUsd(usd, currency).toFixed(decimals);

  async function save(category: string, text: string) {
    if (!householdId) return;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return setError('Enter a number of zero or more.');
    setError('');
    try {
      await setCategoryBudget(householdId, category, convertEntryToUsd(n, currency));
      setEditing(null);
    } catch {
      setError('Could not save. Check your connection and try again.');
    }
  }
  const startEdit = (category: string, usd: number) => { setEditing(category); setDraft(toDisplay(usd)); setError(''); };

  return (
    <>
      <div className="head">
        <div><h1>Budgets</h1><p className="sub">{label}</p></div>
        <MonthPicker />
      </div>

      <div className="grid kpis">
        <div className={`card kpi tone-${overview.leftOfTotal >= 0 ? 'green' : 'red'}`}><span className="kpi-ico" aria-hidden="true">🎯</span>
          <div className="label">{overview.leftOfTotal >= 0 ? 'Left of total budget' : 'Over total budget'}</div>
          <div className="value">{fmt(Math.abs(overview.leftOfTotal))}</div></div>
        <div className="card kpi tone-blue"><span className="kpi-ico" aria-hidden="true">📋</span><div className="label">Total budget</div><div className="value">{fmt(overview.totalBudget)}</div></div>
        <div className="card kpi tone-amber"><span className="kpi-ico" aria-hidden="true">🧾</span><div className="label">Spent</div><div className="value">{fmt(overview.totalSpent)}</div>
          <div className="note">{overview.totalBudget > 0 ? `${Math.round((overview.totalSpent / overview.totalBudget) * 100)}% of budget` : 'No budgets yet'}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Categories <small>tap an amount to change it</small></h2>
        {overview.lines.length === 0 ? <div className="empty">No budgets yet. Add one below.</div> : overview.lines.map((l) => (
          <div className="brow" key={l.category}>
            <div className="l">
              <span>{categoryIcon(l.category)} {l.category}</span>
              <span className={STATUS_CLASS[l.status]}>{l.left >= 0 ? `${fmt(l.left)} left` : `Over by ${fmt(-l.left)}`}</span>
            </div>
            <div className="meter"><span style={{ width: `${l.ratio * 100}%`, background: STATUS_COLOR[l.status] }} /></div>
            <div className="row-between" style={{ marginTop: 6, fontSize: 13 }}>
              <span className="muted">{fmt(l.spent)} spent of</span>
              {editing === l.category ? (
                <span className="inline-edit">
                  <input type="number" step="0.01" min="0" value={draft} autoFocus aria-label={`${l.category} budget`}
                    onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(l.category, draft); if (e.key === 'Escape') setEditing(null); }} />
                  <button className="btn sm primary" onClick={() => void save(l.category, draft)}>Save</button>
                  <button className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
                </span>
              ) : (
                <span className="inline-edit">
                  <button className="link" onClick={() => startEdit(l.category, l.limit)}>{fmt(l.limit)}</button>
                  <button className="btn sm danger" onClick={() => { if (confirm(`Remove the ${l.category} budget?`)) void save(l.category, '0'); }}>Remove</button>
                </span>
              )}
            </div>
          </div>
        ))}
        {error && <div className="err" role="alert" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      <div className="grid cols-2">
        <form className="card" onSubmit={(e) => { e.preventDefault(); if (!newCat) return setError('Choose a category.'); void save(newCat, newAmount).then(() => { setNewCat(''); setNewAmount(''); }); }}>
          <h2>Add a budget</h2>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <select value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="Category">
              <option value="">Choose category</option>
              {unbudgeted.map((c) => <option key={c} value={c}>{categoryIcon(c)} {c}</option>)}
            </select>
            <input type="number" step="0.01" min="0" placeholder={`Amount (${currency})`} value={newAmount} onChange={(e) => setNewAmount(e.target.value)} aria-label="Budget amount" />
            <button className="btn primary">Add</button>
          </div>
        </form>
        <div className="card">
          <h2>Alerts</h2>
          <label className="switch-row">
            <span>Notify me when a category nears its budget<br /><small className="muted">Applies to your whole household and shows on the phone app.</small></span>
            <input type="checkbox" checked={budgetAlerts} onChange={(e) => householdId && void setBudgetAlertsEnabled(householdId, e.target.checked)} />
          </label>
        </div>
      </div>
    </>
  );
}
