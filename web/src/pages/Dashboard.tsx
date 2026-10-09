import { useMemo } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { computeBudgetOverview } from '@app/lib/budgetOverview';
import { computeCashflow } from '@app/lib/cashflowStats';
import { computeStats } from '@app/lib/dashboardStats';
import { categoryIcon } from '@app/constants/categories';
import { useData } from '../data';
import { computeBudgetSpend, dailySeries, dateLabel, daysInMonth, inMonth, shiftMonth, topStores, trend, upcomingRecurring } from '../lib/stats';
import { useMoney } from '../money';
import { INCOME_COLORS, INCOME_LABELS, SERIES, STATUS_CLASS, STATUS_COLOR } from '../palette';
import { MonthPicker, usePeriod } from '../period';

const pct = (n: number) => `${Math.round(n)}%`;

export default function Dashboard() {
  const { receipts, incomes, budgets, members, memberName } = useData();
  const { year, month, label } = usePeriod();
  const fmt = useMoney();

  const m = useMemo(() => {
    const rs = inMonth(receipts, year, month);
    const is = inMonth(incomes, year, month);
    const prev = shiftMonth(year, month, -1);
    const prevSpent = inMonth(receipts, prev.year, prev.month).reduce((s, r) => s + r.totalAmount, 0);
    const stats = computeStats(rs);
    const cash = computeCashflow(is, rs);
    const now = new Date();
    const isCurrent = now.getFullYear() === year && now.getMonth() + 1 === month;
    const elapsed = isCurrent ? now.getDate() : daysInMonth(year, month);
    const dayAvg = elapsed > 0 ? stats.totalSpent / elapsed : 0;
    return {
      rs, is, stats, cash, prevSpent, isCurrent, dayAvg,
      projected: isCurrent ? dayAvg * daysInMonth(year, month) : stats.totalSpent,
      daily: dailySeries(rs, year, month),
      months: trend(receipts, incomes, year, month, 6),
      budget: computeBudgetOverview(budgets, computeBudgetSpend(rs)),
      stores: topStores(rs),
      biggest: [...rs].sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 5),
      recent: [...rs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
      recurring: upcomingRecurring(receipts).slice(0, 5),
    };
  }, [receipts, incomes, budgets, year, month]);

  const { stats, cash } = m;
  const delta = m.prevSpent > 0 ? ((stats.totalSpent - m.prevSpent) / m.prevSpent) * 100 : null;
  const noData = m.rs.length === 0 && m.is.length === 0;
  const catColor = (i: number) => SERIES[i % SERIES.length];

  return (
    <>
      <div className="head">
        <div><h1>Dashboard</h1><p className="sub">{label}</p></div>
        <MonthPicker />
      </div>

      <div className="grid kpis">
        <div className="card kpi tone-amber"><span className="kpi-ico" aria-hidden="true">🧾</span><div className="label">Spent</div><div className="value">{fmt(stats.totalSpent)}</div>
          <div className="note">{delta === null ? 'No spending last month' : <span className={delta > 0 ? 'over' : 'ok'}>{delta > 0 ? '▲' : '▼'} {pct(Math.abs(delta))}</span>} {delta !== null && 'vs last month'}</div></div>
        <div className="card kpi tone-green"><span className="kpi-ico" aria-hidden="true">💰</span><div className="label">Earned</div><div className="value">{fmt(cash.totalEarned)}</div><div className="note">{cash.incomeCount} income {cash.incomeCount === 1 ? 'entry' : 'entries'}</div></div>
        <div className={`card kpi tone-${cash.net >= 0 ? 'blue' : 'red'}`}><span className="kpi-ico" aria-hidden="true">⚖️</span><div className="label">Net</div><div className={`value ${cash.net >= 0 ? 'ok' : 'over'}`}>{fmt(cash.net)}</div><div className="note">Earned minus spent</div></div>
        <div className="card kpi tone-violet"><span className="kpi-ico" aria-hidden="true">📈</span><div className="label">Invested</div><div className="value">{fmt(cash.investedUsd)}</div><div className="note">{cash.savingsRate === null ? 'No income to compare' : `${pct(cash.savingsRate * 100)} of earnings`}</div></div>
        <div className="card kpi tone-teal"><span className="kpi-ico" aria-hidden="true">🗂️</span><div className="label">Receipts</div><div className="value">{stats.receiptCount}</div><div className="note">Avg {fmt(stats.receiptCount ? stats.totalSpent / stats.receiptCount : 0)} each</div></div>
        <div className="card kpi tone-rose"><span className="kpi-ico" aria-hidden="true">🔮</span><div className="label">{m.isCurrent ? 'Projected month-end' : 'Daily average'}</div><div className="value">{fmt(m.isCurrent ? m.projected : m.dayAvg)}</div><div className="note">{fmt(m.dayAvg)} per day</div></div>
      </div>

      {noData && <div className="card empty" style={{ marginBottom: 16 }}>Nothing recorded for {label}. Add receipts or income on the mobile app or the pages on the left.</div>}

      <div className="grid cols-wide">
        <div className="card">
          <h2>Spending through the month <small>daily and running total</small></h2>
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <ComposedChart data={m.daily} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="d" tick={{ fontSize: 12, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} width={68} tickFormatter={(v) => fmt(v as number).replace(/\.\d+$/, '')} />
                <YAxis yAxisId="t" orientation="right" hide />
                <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={(d) => `Day ${d}`} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }} />
                <Bar yAxisId="d" dataKey="spent" name="That day" fill="#4f8ef7" radius={[4, 4, 0, 0]} />
                <Line yAxisId="t" dataKey="total" name="Running total" stroke="#10b981" strokeWidth={2.5} dot={false} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <h2>Where it went <small>{stats.categories.length} categories</small></h2>
          {stats.categories.length === 0 ? <div className="empty">No spending yet</div> : (
            <>
              <div style={{ height: 190 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={stats.categories} dataKey="total" nameKey="category" innerRadius={52} outerRadius={84} paddingAngle={2} stroke="none">
                      {stats.categories.map((c, i) => <Cell key={c.category} fill={catColor(i)} />)}
                    </Pie>
                    <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <table><tbody>
                {stats.categories.slice(0, 7).map((c, i) => (
                  <tr key={c.category}><td><span className="dot" style={{ background: catColor(i) }} />{categoryIcon(c.category)} {c.category}</td><td className="num">{fmt(c.total)}</td><td className="num muted">{pct(c.percentage)}</td></tr>
                ))}
              </tbody></table>
            </>
          )}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h2>Earned vs spent <small>last 6 months</small></h2>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <ComposedChart data={m.months} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--ink-3)' }} tickLine={false} axisLine={false} width={68} tickFormatter={(v) => fmt(v as number).replace(/\.\d+$/, '')} />
                <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12 }} />
                <Legend />
                <Bar dataKey="earned" name="Earned" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="spent" name="Spent" fill="#f2b544" radius={[4, 4, 0, 0]} />
                <Line dataKey="net" name="Net" stroke="#4f8ef7" strokeWidth={2.5} dot type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <h2>Budgets <small>{m.budget.lines.length ? `${fmt(m.budget.totalSpent)} of ${fmt(m.budget.totalBudget)}` : ''}</small></h2>
          {m.budget.lines.length === 0 ? <div className="empty">No budgets set. Add them in the mobile app's Settings.</div> : (
            <>
              <div className="kpi"><div className="label">{m.budget.leftOfTotal >= 0 ? 'Left of total budget' : 'Over total budget'}</div>
                <div className={`value ${m.budget.leftOfTotal >= 0 ? 'ok' : 'over'}`}>{fmt(Math.abs(m.budget.leftOfTotal))}</div></div>
              {m.budget.lines.map((l) => (
                <div className="brow" key={l.category}>
                  <div className="l"><span>{categoryIcon(l.category)} {l.category}</span>
                    <span className={STATUS_CLASS[l.status]}>{l.left >= 0 ? `${fmt(l.left)} left` : `Over by ${fmt(-l.left)}`}</span></div>
                  <div className="meter"><span style={{ width: `${l.ratio * 100}%`, background: STATUS_COLOR[l.status] }} /></div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="grid cols-3">
        <div className="card">
          <h2>Earnings by person</h2>
          {cash.byMember.length === 0 ? <div className="empty">No income yet</div> : (
            <>
              <div className="bar">{cash.byMember.map((x, i) => <span key={x.earnedBy} style={{ width: `${(x.total / cash.totalEarned) * 100}%`, background: catColor(i) }} />)}</div>
              <div className="legend">{cash.byMember.map((x, i) => <span key={x.earnedBy}><i style={{ background: catColor(i) }} />{memberName(x.earnedBy)} {fmt(x.total)} ({pct((x.total / cash.totalEarned) * 100)})</span>)}</div>
              {members.length > 0 && <p className="sub" style={{ marginTop: 10 }}>{members.length} {members.length === 1 ? 'member' : 'members'} in your household</p>}
            </>
          )}
        </div>
        <div className="card">
          <h2>Income by type</h2>
          {cash.byCategory.length === 0 ? <div className="empty">No income yet</div> : (
            <>
              <div className="bar">{cash.byCategory.map((x) => <span key={x.category} style={{ width: `${(x.total / cash.totalEarned) * 100}%`, background: INCOME_COLORS[x.category] ?? '#8e96aa' }} />)}</div>
              <div className="legend">{cash.byCategory.map((x) => <span key={x.category}><i style={{ background: INCOME_COLORS[x.category] ?? '#8e96aa' }} />{INCOME_LABELS[x.category] ?? x.category} {fmt(x.total)}</span>)}</div>
            </>
          )}
        </div>
        <div className="card">
          <h2>Top stores</h2>
          {m.stores.length === 0 ? <div className="empty">No receipts yet</div> : (
            <table><tbody>{m.stores.map((s) => <tr key={s.store}><td>{s.store}<div className="muted" style={{ fontSize: 12 }}>{s.count} {s.count === 1 ? 'visit' : 'visits'}</div></td><td className="num">{fmt(s.total)}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>

      <div className="grid cols-3">
        <div className="card">
          <h2>Biggest purchases</h2>
          {m.biggest.length === 0 ? <div className="empty">Nothing yet</div> : (
            <table><tbody>{m.biggest.map((r) => <tr key={r.id}><td>{r.storeName}<div className="muted" style={{ fontSize: 12 }}>{dateLabel(r.date)}</div></td><td className="num">{fmt(r.totalAmount)}</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="card">
          <h2>Upcoming recurring</h2>
          {m.recurring.length === 0 ? <div className="empty">No active recurring expenses</div> : (
            <table><tbody>{m.recurring.map((x) => <tr key={x.receipt.id}><td>{x.receipt.storeName}<div className="muted" style={{ fontSize: 12 }}>Next {dateLabel(x.due)} · {x.frequency}</div></td><td className="num">{fmt(x.receipt.totalAmount)}</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="card">
          <h2>Recent receipts</h2>
          {m.recent.length === 0 ? <div className="empty">Nothing yet</div> : (
            <table><tbody>{m.recent.map((r) => <tr key={r.id}><td>{r.storeName}<div className="muted" style={{ fontSize: 12 }}>{dateLabel(r.date)} · {r.category}</div></td><td className="num">{fmt(r.totalAmount)}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>
    </>
  );
}
