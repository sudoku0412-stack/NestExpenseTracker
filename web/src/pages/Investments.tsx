import { useMemo, useState, type FormEvent } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { formatLocalDate } from '@app/lib/calendarDate';
import { convertEntryToUsd, convertFromUsd, currencyDecimals } from '@app/lib/currency';
import { INVESTMENT_KIND_ICONS, INVESTMENT_KINDS, accountGain, applyContribution, applyValueUpdate, snapshotOf, summarizeInvestments } from '@app/lib/investments';
import type { InvestmentAccount, InvestmentKind } from '@app/types';
import { useAuth } from '../auth';
import { Modal } from '../components';
import { useData } from '../data';
import { PremiumGate } from '../premium';
import { deleteInvestment, saveInvestment, saveInvestmentSnapshot } from '../lib/writes';
import { useMoney } from '../money';

const KIND_LABEL: Record<InvestmentKind, string> = { stocks: 'Stocks', etf: 'ETFs and funds', crypto: 'Crypto', retirement: 'Retirement', savings: 'Savings', other: 'Other' };
const KIND_COLOR: Record<InvestmentKind, string> = { stocks: '#4f8ef7', etf: '#9b6bf2', crypto: '#f2b544', retirement: '#2db5a3', savings: '#3dbe6c', other: '#8e96aa' };

type Dialog = { kind: 'new' } | { kind: 'edit'; account: InvestmentAccount } | { kind: 'deposit' | 'withdraw' | 'value'; account: InvestmentAccount } | { kind: 'history'; account: InvestmentAccount };

export default function Investments() {
  return <PremiumGate feature="Investments"><InvestmentsPage /></PremiumGate>;
}

function InvestmentsPage() {
  const { user } = useAuth();
  const { investments, investmentSnapshots, currency } = useData();
  const fmt = useMoney();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const sum = useMemo(() => summarizeInvestments(investments), [investments]);
  const byKind = useMemo(() => INVESTMENT_KINDS.map((k) => ({ k, v: investments.filter((a) => a.kind === k).reduce((s, a) => s + a.valueUsd, 0) })).filter((x) => x.v > 0), [investments]);
  const gainText = (usd: number, pct: number | null) => `${usd > 0 ? '+' : usd < 0 ? '−' : ''}${fmt(Math.abs(usd))}${pct == null ? '' : ` (${usd > 0 ? '+' : usd < 0 ? '−' : ''}${Math.abs(pct).toFixed(1)}%)`}`;
  const gainClass = sum.gainUsd >= 0 ? 'ok' : 'over';

  /** Save the account and a dated snapshot, like the phone does after every change. */
  async function commit(next: InvestmentAccount) {
    if (!user) return;
    await saveInvestment(user.uid, next);
    await saveInvestmentSnapshot(user.uid, snapshotOf(next, crypto.randomUUID(), formatLocalDate(new Date()), next.updatedAt));
  }

  return (
    <>
      <div className="head">
        <div><h1>Investments</h1><p className="sub">Personal. Only you can see these, not your household.</p></div>
        <button className="btn primary" onClick={() => setDialog({ kind: 'new' })}>+ Add account</button>
      </div>

      <div className="grid kpis">
        <div className="card kpi tone-violet"><span className="kpi-ico" aria-hidden="true">📈</span><div className="label">Total value</div><div className="value">{fmt(sum.valueUsd)}</div><div className="note">{investments.length} {investments.length === 1 ? 'account' : 'accounts'}</div></div>
        <div className="card kpi tone-blue"><span className="kpi-ico" aria-hidden="true">💵</span><div className="label">Contributed</div><div className="value">{fmt(sum.contributedUsd)}</div><div className="note">Net of withdrawals</div></div>
        <div className={`card kpi tone-${sum.gainUsd >= 0 ? 'green' : 'red'}`}><span className="kpi-ico" aria-hidden="true">{sum.gainUsd >= 0 ? '🚀' : '📉'}</span><div className="label">Gain</div><div className={`value ${gainClass}`}>{gainText(sum.gainUsd, null).replace(/ \(.*/, '')}</div><div className="note">{sum.gainPct == null ? 'Nothing contributed yet' : `${sum.gainPct >= 0 ? '+' : '−'}${Math.abs(sum.gainPct).toFixed(1)}% on what you put in`}</div></div>
      </div>

      {byKind.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>Where it is</h2>
          <div className="bar">{byKind.map((x) => <span key={x.k} style={{ width: `${(x.v / sum.valueUsd) * 100}%`, background: KIND_COLOR[x.k] }} />)}</div>
          <div className="legend">{byKind.map((x) => <span key={x.k}><i style={{ background: KIND_COLOR[x.k] }} />{INVESTMENT_KIND_ICONS[x.k]} {KIND_LABEL[x.k]} {fmt(x.v)} ({Math.round((x.v / sum.valueUsd) * 100)}%)</span>)}</div>
        </div>
      )}

      {investments.length === 0 ? <div className="card empty">No investment accounts yet. Add a brokerage, TFSA, RRSP, 401k or crypto wallet to track it here and on your phone.</div> : (
        <div className="masonry">
          {[...investments].sort((a, b) => b.valueUsd - a.valueUsd).map((a) => {
            const g = accountGain(a);
            return (
              <div className="card" key={a.id}>
                <div className="row-between"><h2 style={{ margin: 0 }}>{INVESTMENT_KIND_ICONS[a.kind]} {a.name}</h2><span className="chip">{KIND_LABEL[a.kind]}</span></div>
                <div className="kpi-plain"><div className="big-num">{fmt(a.valueUsd)}</div>
                  <div className={g.gainUsd >= 0 ? 'ok' : 'over'} style={{ fontWeight: 700 }}>{gainText(g.gainUsd, g.gainPct)}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{fmt(a.contributedUsd)} contributed</div></div>
                {a.notes && <p style={{ fontSize: 14, marginTop: 6 }}>{a.notes}</p>}
                <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
                  <button className="btn sm primary" onClick={() => setDialog({ kind: 'deposit', account: a })}>Deposit</button>
                  <button className="btn sm" onClick={() => setDialog({ kind: 'withdraw', account: a })}>Withdraw</button>
                  <button className="btn sm" onClick={() => setDialog({ kind: 'value', account: a })}>Update value</button>
                </div>
                <div className="row-between" style={{ marginTop: 10 }}>
                  <button className="link" onClick={() => setDialog({ kind: 'history', account: a })}>History</button>
                  <span><button className="link" onClick={() => setDialog({ kind: 'edit', account: a })}>Edit</button>{' · '}
                    <button className="link over" onClick={() => { if (user && confirm(`Delete "${a.name}" and its history?`)) void deleteInvestment(user.uid, a.id, investmentSnapshots.filter((s) => s.accountId === a.id).map((s) => s.id)); }}>Delete</button></span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialog && user && (
        <Dialogs dialog={dialog} onClose={() => setDialog(null)} currency={currency} fmt={fmt} snapshots={investmentSnapshots}
          onNew={async (v) => { const now = new Date().toISOString(); await commit({ id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...v }); }}
          onEdit={async (a, v) => { await saveInvestment(user.uid, { ...a, ...v, updatedAt: new Date().toISOString() }); }}
          onDeposit={async (a, usd) => commit(applyContribution(a, usd, new Date().toISOString()))}
          onValue={async (a, usd) => commit(applyValueUpdate(a, usd, new Date().toISOString()))} />
      )}
    </>
  );
}

function Dialogs({ dialog, onClose, currency, fmt, snapshots, onNew, onEdit, onDeposit, onValue }: {
  dialog: Dialog; onClose: () => void; currency: ReturnType<typeof useData>['currency']; fmt: (n: number) => string; snapshots: ReturnType<typeof useData>['investmentSnapshots'];
  onNew: (v: { name: string; kind: InvestmentKind; contributedUsd: number; valueUsd: number; notes?: string }) => Promise<void>;
  onEdit: (a: InvestmentAccount, v: { name: string; kind: InvestmentKind; notes?: string }) => Promise<void>;
  onDeposit: (a: InvestmentAccount, usd: number) => Promise<void>;
  onValue: (a: InvestmentAccount, usd: number) => Promise<void>;
}) {
  const acct = dialog.kind === 'new' ? undefined : dialog.account;
  const dec = currencyDecimals(currency);
  const [name, setName] = useState(acct?.name ?? '');
  const [kind, setKind] = useState<InvestmentKind>(acct?.kind ?? 'stocks');
  const [notes, setNotes] = useState(acct?.notes ?? '');
  const [contributed, setContributed] = useState('');
  const [amount, setAmount] = useState(dialog.kind === 'value' && acct ? convertFromUsd(acct.valueUsd, currency).toFixed(dec) : '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (dialog.kind === 'history') {
    const rows = snapshots.filter((s) => s.accountId === dialog.account.id).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    return (
      <Modal title={`${dialog.account.name} history`} onClose={onClose}>
        {rows.length === 0 ? <div className="empty">No history yet. It builds each time you deposit, withdraw or update the value.</div> : (<>
          <div style={{ height: 180 }}><ResponsiveContainer><BarChart data={rows.slice(-12).map((r) => ({ date: r.date.slice(5), value: r.valueUsd }))}>
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} /><Tooltip formatter={(v) => fmt(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }} />
            <Bar dataKey="value" name="Value" fill="#9b6bf2" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
          <table><tbody>{[...rows].reverse().map((r) => <tr key={r.id}><td>{r.date}</td><td className="num">{fmt(r.valueUsd)}</td><td className="num muted">{fmt(r.contributedUsd)} in</td></tr>)}</tbody></table></>)}
      </Modal>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      if (dialog.kind === 'new' || dialog.kind === 'edit') {
        if (!name.trim()) return setErr('Give the account a name.');
        setBusy(true);
        if (dialog.kind === 'new') await onNew({ name, kind, notes, contributedUsd: convertEntryToUsd(Number(contributed) || 0, currency), valueUsd: convertEntryToUsd(Number(amount) || 0, currency) });
        else await onEdit(dialog.account, { name, kind, notes });
      } else {
        const n = Number(amount);
        if (!(n > 0) && !(dialog.kind === 'value' && n === 0)) return setErr('Enter an amount greater than zero.');
        setBusy(true);
        const usd = convertEntryToUsd(n, currency);
        if (dialog.kind === 'value') await onValue(dialog.account, usd);
        else await onDeposit(dialog.account, dialog.kind === 'withdraw' ? -usd : usd);
      }
      onClose();
    } catch {
      setErr('Could not save. Check your connection and try again.');
      setBusy(false);
    }
  }
  const title = { new: 'Add account', edit: 'Edit account', deposit: 'Deposit', withdraw: 'Withdraw', value: 'Update value' }[dialog.kind];
  return (
    <Modal title={acct && dialog.kind !== 'edit' ? `${title}: ${acct.name}` : title} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        {(dialog.kind === 'new' || dialog.kind === 'edit') && (<>
          <label>Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="TFSA" /></label>
          <label>Kind<select value={kind} onChange={(e) => setKind(e.target.value as InvestmentKind)}>{INVESTMENT_KINDS.map((k) => <option key={k} value={k}>{INVESTMENT_KIND_ICONS[k]} {KIND_LABEL[k]}</option>)}</select></label>
        </>)}
        {dialog.kind === 'new' && <label>Amount contributed so far ({currency})<input type="number" step="0.01" min="0" value={contributed} onChange={(e) => setContributed(e.target.value)} /></label>}
        {dialog.kind !== 'edit' && <label>{dialog.kind === 'new' || dialog.kind === 'value' ? `Current value (${currency})` : `Amount (${currency})`}<input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus={dialog.kind !== 'new'} /></label>}
        {(dialog.kind === 'new' || dialog.kind === 'edit') && <label>Notes (optional)<input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>}
        {dialog.kind === 'deposit' && <p className="sub">A deposit raises both what you contributed and the current value.</p>}
        {dialog.kind === 'withdraw' && <p className="sub">A withdrawal lowers both what you contributed and the current value.</p>}
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row-between"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}
