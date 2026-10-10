import { useMemo, useState } from 'react';
import { computeMemberBalances, computeReceiptNet, getReceiptsForMemberPair } from '@app/lib/balances';
import { convertEntryToUsd, convertFromUsd, currencyDecimals } from '@app/lib/currency';
import type { HouseholdMember } from '@app/types';
import { useAuth } from '../auth';
import { useData } from '../data';
import { dateLabel } from '../lib/stats';
import { addSettlement } from '../lib/writes';
import { useMoney } from '../money';

export default function Balances() {
  const { user } = useAuth();
  const { receipts, settlements, members, memberName, householdId, currency } = useData();
  const fmt = useMoney();
  const [open, setOpen] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const self = user?.uid ?? '';

  const rows = useMemo(() => {
    const people: HouseholdMember[] = members.map((m) => ({ uid: m.uid, email: m.email, displayName: m.name, role: 'member', isYou: m.uid === self }));
    return computeMemberBalances(receipts, settlements, self, people);
  }, [receipts, settlements, members, self]);

  async function settle(memberUid: string, netUsd: number) {
    if (!householdId) return;
    const entered = amounts[memberUid];
    const usd = entered ? convertEntryToUsd(Number(entered), currency) : Math.abs(netUsd);
    if (!(usd > 0)) return setError('Enter an amount greater than zero.');
    setError('');
    try {
      // They owe you: they pay you. You owe them: you pay them.
      await (netUsd > 0 ? addSettlement(householdId, memberUid, self, usd) : addSettlement(householdId, self, memberUid, usd));
      setAmounts((a) => ({ ...a, [memberUid]: '' }));
    } catch {
      setError('Could not record the payment. Try again.');
    }
  }

  return (
    <>
      <div className="head"><div><h1>Balances</h1><p className="sub">Who owes whom across your split expenses</p></div></div>
      {rows.length === 0 ? (
        <div className="card empty">Nobody else is in your household yet. Invite someone from the mobile app to split expenses.</div>
      ) : (
        <div className="grid cols-2">
          {rows.map((b) => {
            const settled = Math.abs(b.netUsd) < 0.005;
            const theirs = receiptsFor(receipts, self, b.memberUid);
            return (
              <div className="card" key={b.memberUid}>
                <div className="row-between">
                  <h2 style={{ margin: 0 }}>{memberName(b.memberUid)}</h2>
                  <span className={settled ? 'muted' : b.netUsd > 0 ? 'ok' : 'over'} style={{ fontWeight: 800, fontSize: 20 }}>{settled ? 'Settled up' : fmt(Math.abs(b.netUsd))}</span>
                </div>
                <p className="sub">{settled ? 'No balance between you.' : b.netUsd > 0 ? `${memberName(b.memberUid)} owes you` : `You owe ${memberName(b.memberUid)}`}</p>
                {!settled && (
                  <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
                    <input type="number" step="0.01" min="0" placeholder={`${convertFromUsd(Math.abs(b.netUsd), currency).toFixed(currencyDecimals(currency))} (all)`}
                      value={amounts[b.memberUid] ?? ''} onChange={(e) => setAmounts((a) => ({ ...a, [b.memberUid]: e.target.value }))} aria-label="Amount to settle" />
                    <button className="btn primary" onClick={() => void settle(b.memberUid, b.netUsd)}>Settle up</button>
                  </div>
                )}
                <button className="link" style={{ marginTop: 12 }} onClick={() => setOpen(open === b.memberUid ? null : b.memberUid)}>
                  {open === b.memberUid ? 'Hide' : 'Show'} {theirs.length} shared {theirs.length === 1 ? 'expense' : 'expenses'}
                </button>
                {open === b.memberUid && (
                  <div className="table-wrap"><table><tbody>
                    {theirs.map((r) => {
                      const net = computeReceiptNet(r, self, b.memberUid);
                      return <tr key={r.id}><td>{r.storeName}<div className="muted" style={{ fontSize: 12 }}>{dateLabel(r.date)}</div></td>
                        <td className={`num ${net > 0 ? 'ok' : 'over'}`}>{net > 0 ? '+' : ''}{fmt(net)}</td></tr>;
                    })}
                  </tbody></table></div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && <div className="err" role="alert" style={{ marginTop: 12 }}>{error}</div>}
    </>
  );
}

const receiptsFor = getReceiptsForMemberPair;
