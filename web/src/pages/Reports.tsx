import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { categoryIcon } from '@app/constants/categories';
import { formatLocalDate } from '@app/lib/calendarDate';
import { computeCashflow } from '@app/lib/cashflowStats';
import { categoryTrends, filterReceiptsInRange, findRecurring, monthlyTrend, periodOverPeriodDelta, receiptsToCsv, topStores } from '@app/lib/reports';
import { useData } from '../data';
import { useMoney } from '../money';
import { SERIES } from '../palette';

type Preset = 'month' | 'last' | '3m' | 'ytd' | '12m' | 'custom';
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'month', label: 'This month' }, { id: 'last', label: 'Last month' }, { id: '3m', label: 'Last 3 months' },
  { id: 'ytd', label: 'Year to date' }, { id: '12m', label: 'Last 12 months' }, { id: 'custom', label: 'Custom' },
];

function rangeFor(preset: Preset, now: Date): { start: Date; end: Date } {
  const y = now.getFullYear(), m = now.getMonth();
  switch (preset) {
    case 'last': return { start: new Date(y, m - 1, 1), end: new Date(y, m, 0) };
    case '3m': return { start: new Date(y, m - 2, 1), end: new Date(y, m + 1, 0) };
    case 'ytd': return { start: new Date(y, 0, 1), end: new Date(y, m + 1, 0) };
    case '12m': return { start: new Date(y, m - 11, 1), end: new Date(y, m + 1, 0) };
    default: return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0) };
  }
}
const parseYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

export default function Reports() {
  const { receipts, incomes, currency } = useData();
  const fmt = useMoney();
  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(formatLocalDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(formatLocalDate(new Date()));
  const [trendCat, setTrendCat] = useState('');

  const { start, end } = useMemo(() => {
    if (preset === 'custom') {
      const s = parseYmd(from), e = parseYmd(to);
      return s <= e ? { start: s, end: e } : { start: e, end: s };
    }
    return rangeFor(preset, new Date());
  }, [preset, from, to]);

  const r = useMemo(() => {
    const scoped = filterReceiptsInRange(receipts, start, end);
    const inc = incomes.filter((i) => { const d = parseYmd(i.date.slice(0, 10)); return d >= start && d <= end; });
    const delta = periodOverPeriodDelta(receipts, start, end);
    const cash = computeCashflow(inc, scoped);
    const trend = monthlyTrend(receipts, end.getFullYear(), end.getMonth() + 1, 12);
    const cats = categoryTrends(receipts, end.getFullYear(), end.getMonth() + 1, 6);
    return { scoped, delta, cash, trend, cats, stores: topStores(scoped, 8), recurring: findRecurring(receipts, 3).slice(0, 8) };
  }, [receipts, incomes, start, end]);

  const cur = r.delta.current;
  const pickedTrend = r.cats.find((c) => c.category === (trendCat || r.cats[0]?.category));
  const exportCsv = () => {
    const blob = new Blob([receiptsToCsv(r.scoped, currency)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `NestExpenseTracker ${formatLocalDate(start)} to ${formatLocalDate(end)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const tip = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 };
  const axis = { fontSize: 12, fill: 'var(--ink-3)' };
  const compact = (v: unknown) => fmt(Number(v)).replace(/\.\d+$/, '');

  return (
    <>
      <div className="head">
        <div><h1>Reports</h1><p className="sub">{start.toLocaleDateString('en-US', { dateStyle: 'medium' })} to {end.toLocaleDateString('en-US', { dateStyle: 'medium' })}</p></div>
        <button className="btn" onClick={exportCsv} disabled={r.scoped.length === 0}>⬇ Export CSV</button>
      </div>
      <div className="toolbar">
        {PRESETS.map((p) => <button key={p.id} className={`chip-btn${preset === p.id ? ' on' : ''}`} onClick={() => setPreset(p.id)}>{p.label}</button>)}
        {preset === 'custom' && (<><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" /><input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" /></>)}
      </div>

      <div className="grid kpis">
        <div className="card kpi tone-amber"><span className="kpi-ico" aria-hidden="true">🧾</span><div className="label">Spent</div><div className="value">{fmt(cur.total)}</div>
          <div className="note">{r.delta.deltaPct === null ? 'No previous period' : <span className={r.delta.delta > 0 ? 'over' : 'ok'}>{r.delta.delta > 0 ? '▲' : '▼'} {Math.round(Math.abs(r.delta.deltaPct) * 100)}%</span>} {r.delta.deltaPct !== null && 'vs previous period'}</div></div>
        <div className="card kpi tone-green"><span className="kpi-ico" aria-hidden="true">💰</span><div className="label">Earned</div><div className="value">{fmt(r.cash.totalEarned)}</div><div className="note">{r.cash.incomeCount} entries</div></div>
        <div className={`card kpi tone-${r.cash.net >= 0 ? 'blue' : 'red'}`}><span className="kpi-ico" aria-hidden="true">⚖️</span><div className="label">Net</div><div className="value">{fmt(r.cash.net)}</div><div className="note">Earned minus spent</div></div>
        <div className="card kpi tone-teal"><span className="kpi-ico" aria-hidden="true">🗂️</span><div className="label">Receipts</div><div className="value">{cur.receiptCount}</div><div className="note">Avg {fmt(cur.avgPerReceipt)}</div></div>
        <div className="card kpi tone-violet"><span className="kpi-ico" aria-hidden="true">🏆</span><div className="label">Top category</div><div className="value" style={{ fontSize: 20 }}>{cur.topCategory ? `${categoryIcon(cur.topCategory.category as string)} ${cur.topCategory.category}` : '—'}</div><div className="note">{cur.topCategory ? fmt(cur.topCategory.total) : 'No spending'}</div></div>
        <div className="card kpi tone-rose"><span className="kpi-ico" aria-hidden="true">💎</span><div className="label">Biggest receipt</div><div className="value">{cur.biggestReceipt ? fmt(cur.biggestReceipt.total) : '—'}</div><div className="note">{cur.biggestReceipt?.storeName ?? 'No receipts'}</div></div>
      </div>

      <div className="masonry">
        <div className="card"><h2>Spending by month <small>last 12 months</small></h2>
          <div style={{ height: 250 }}><ResponsiveContainer><BarChart data={r.trend} margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
            <XAxis dataKey="shortLabel" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} width={68} tickFormatter={compact} />
            <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={tip} /><Bar dataKey="total" name="Spent" fill="#4f8ef7" radius={[4, 4, 0, 0]} />
          </BarChart></ResponsiveContainer></div></div>

        <div className="card"><h2>By category <small>{cur.categories.length} categories</small></h2>
          {cur.categories.length === 0 ? <div className="empty">No spending in this period</div> : (
            <table><tbody>{cur.categories.map((c, i) => (
              <tr key={c.category as string}><td><span className="dot" style={{ background: SERIES[i % SERIES.length] }} />{categoryIcon(c.category as string)} {c.category}
                <div className="meter" style={{ marginTop: 4 }}><span style={{ width: `${(c.total / cur.categories[0].total) * 100}%`, background: SERIES[i % SERIES.length] }} /></div></td>
                <td className="num">{fmt(c.total)}</td><td className="num muted">{cur.total ? Math.round((c.total / cur.total) * 100) : 0}%</td></tr>))}</tbody></table>
          )}</div>

        <div className="card"><h2>Category trend
          <select value={pickedTrend?.category ?? ''} onChange={(e) => setTrendCat(e.target.value)} aria-label="Category">{r.cats.map((c) => <option key={c.category as string}>{c.category}</option>)}</select></h2>
          {!pickedTrend ? <div className="empty">No data yet</div> : (<>
            <div style={{ height: 200 }}><ResponsiveContainer><LineChart data={pickedTrend.points} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
              <XAxis dataKey="shortLabel" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} width={68} tickFormatter={compact} />
              <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={tip} /><Line dataKey="total" name={String(pickedTrend.category)} stroke="#10b981" strokeWidth={2.5} dot type="monotone" />
            </LineChart></ResponsiveContainer></div>
            <p className="sub">This month {fmt(pickedTrend.thisMonth)} · last month {fmt(pickedTrend.prevMonth)} · <span className={pickedTrend.delta > 0 ? 'over' : 'ok'}>{pickedTrend.delta > 0 ? '▲' : '▼'} {fmt(Math.abs(pickedTrend.delta))}</span></p></>)}</div>

        <div className="card"><h2>Earned vs spent</h2>
          {r.cash.totalEarned + cur.total === 0 ? <div className="empty">No activity</div> : (
            <div style={{ height: 200 }}><ResponsiveContainer><BarChart data={[{ name: 'This period', Earned: r.cash.totalEarned, Spent: cur.total, Invested: r.cash.investedUsd }]} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} /><XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} />
              <YAxis tick={axis} tickLine={false} axisLine={false} width={68} tickFormatter={compact} /><Tooltip formatter={(v) => fmt(Number(v))} contentStyle={tip} /><Legend />
              <Bar dataKey="Earned" fill="#10b981" radius={[4, 4, 0, 0]} /><Bar dataKey="Spent" fill="#f2b544" radius={[4, 4, 0, 0]} /><Bar dataKey="Invested" fill="#9b6bf2" radius={[4, 4, 0, 0]} />
            </BarChart></ResponsiveContainer></div>)}</div>

        <div className="card"><h2>Top stores</h2>
          {r.stores.length === 0 ? <div className="empty">No receipts</div> : <table><tbody>{r.stores.map((s) => <tr key={s.storeName}><td>{s.storeName}<div className="muted" style={{ fontSize: 12 }}>{s.count} {s.count === 1 ? 'visit' : 'visits'}</div></td><td className="num">{fmt(s.total)}</td></tr>)}</tbody></table>}</div>

        <div className="card"><h2>Looks recurring <small>seen in 3+ months</small></h2>
          {r.recurring.length === 0 ? <div className="empty">Nothing repeats yet</div> : <table><tbody>{r.recurring.map((m) => <tr key={`${m.kind}-${m.label}`}><td>{m.displayName}<div className="muted" style={{ fontSize: 12 }}>{m.kind === 'store' ? 'Store' : 'Item'} · {m.monthKeys.length} months</div></td><td className="num">{fmt(m.total)}</td></tr>)}</tbody></table>}</div>
      </div>
    </>
  );
}
