import { useData } from '../data';
import { FREQUENCIES } from '../lib/schedule';
import { sortRecurringTemplates } from '../lib/listFilter';
import { dateLabel } from '../lib/stats';
import { stopRecurring } from '../lib/writes';
import { useMoney } from '../money';

const FREQ: Record<string, string> = Object.fromEntries(FREQUENCIES.map((f) => [f.id, f.label]));

export default function Recurring() {
  const { receipts, incomes, householdId } = useData();
  const fmt = useMoney();
  const expenses = sortRecurringTemplates(receipts);
  const earnings = sortRecurringTemplates(incomes);
  const stop = (kind: 'receipts' | 'incomes', id: string, name: string) => {
    if (householdId && confirm(`Stop repeating "${name}"? Entries already added stay.`)) void stopRecurring(householdId, kind, id);
  };
  return (
    <>
      <div className="head"><div><h1>Recurring</h1><p className="sub">Bills and paychecks that repeat on a schedule</p></div></div>
      <div className="grid cols-2">
        <div className="card"><h2>Recurring expenses</h2>
          {expenses.length === 0 ? <div className="empty">None yet. Mark an expense as repeating in the mobile app.</div> : (
            <table><tbody>{expenses.map((r) => (
              <tr key={r.id}><td>{r.storeName}<div className="muted" style={{ fontSize: 12 }}>{FREQ[r.recurring!.frequency]} · next {dateLabel(r.recurring!.nextDueDate)} · ends {dateLabel(r.recurring!.endDate)}</div></td>
                <td className="num">{fmt(r.totalAmount)}</td><td className="num"><button className="btn sm danger" onClick={() => stop('receipts', r.id, r.storeName)}>Stop</button></td></tr>
            ))}</tbody></table>
          )}
        </div>
        <div className="card"><h2>Recurring income</h2>
          {earnings.length === 0 ? <div className="empty">None yet. Mark an income as repeating in the mobile app.</div> : (
            <table><tbody>{earnings.map((i) => (
              <tr key={i.id}><td>{i.sourceName}<div className="muted" style={{ fontSize: 12 }}>{FREQ[i.recurring!.frequency]} · next {dateLabel(i.recurring!.nextDueDate)} · ends {dateLabel(i.recurring!.endDate)}</div></td>
                <td className="num">{fmt(i.amountUsd)}</td><td className="num"><button className="btn sm danger" onClick={() => stop('incomes', i.id, i.sourceName)}>Stop</button></td></tr>
            ))}</tbody></table>
          )}
        </div>
      </div>
    </>
  );
}
