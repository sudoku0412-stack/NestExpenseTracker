import { doc, setDoc } from 'firebase/firestore';
import { useState, type FormEvent } from 'react';
import { calendarDateKey, formatLocalDate } from '@app/lib/calendarDate';
import { CURRENCIES, convertEntryToUsd, convertUsdToEntry, currencyDecimals, type CurrencyCode } from '@app/lib/currency';
import type { Income, IncomeCategory } from '@app/types';
import { useAuth } from '../auth';
import { Modal, NO_REPEAT, RecurringFields, type RecurringState } from '../components';
import { useData } from '../data';
import { db } from '../firebase';
import { buildSchedule } from '../lib/schedule';
import { INCOME_LABELS } from '../palette';

const TYPES = Object.keys(INCOME_LABELS) as IncomeCategory[];

export default function IncomeForm({ income, onClose }: { income?: Income; onClose: () => void }) {
  const { user } = useAuth();
  const { householdId, members, currency: displayCurrency } = useData();
  const [currency, setCurrency] = useState<CurrencyCode>(income?.originalCurrency ?? displayCurrency);
  const [source, setSource] = useState(income?.sourceName ?? '');
  const [date, setDate] = useState(income ? calendarDateKey(income.date) ?? formatLocalDate(new Date()) : formatLocalDate(new Date()));
  const [amount, setAmount] = useState(income ? convertUsdToEntry(income.amountUsd, income.originalCurrency ?? displayCurrency).toFixed(currencyDecimals(income.originalCurrency ?? displayCurrency)) : '');
  const [category, setCategory] = useState<IncomeCategory>(income?.category ?? 'Salary');
  const [earnedBy, setEarnedBy] = useState(income?.earnedBy ?? user?.uid ?? members[0]?.uid ?? '');
  const [notes, setNotes] = useState(income?.notes ?? '');
  const [repeat, setRepeat] = useState<RecurringState>(income?.recurring ? { enabled: true, frequency: income.recurring.frequency, months: '' } : NO_REPEAT);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!householdId || !user) return;
    const n = Number(amount);
    if (!source.trim()) return setErr('Enter where the money came from.');
    if (!(n > 0)) return setErr('Enter an amount greater than zero.');
    if (!earnedBy) return setErr('Choose who earned it.');
    const now = new Date().toISOString();
    const id = income?.id ?? crypto.randomUUID();
    setBusy(true);
    try {
      await setDoc(
        doc(db, 'households', householdId, 'incomes', id),
        {
          sourceName: source.trim(),
          date,
          amountUsd: Math.round(convertEntryToUsd(n, currency) * 100) / 100,
          category,
          earnedBy,
          notes: notes.trim() || null,
          originalCurrency: currency,
          recurring: buildSchedule(repeat.enabled, repeat.frequency, date, parseInt(repeat.months, 10) || 0, income?.recurring?.endDate),
          ...(income ? {} : { isRecurringOccurrence: false, createdBy: user.uid, createdAt: now }),
          updatedAt: now,
        },
        { merge: true },
      );
      onClose();
    } catch {
      setErr('Could not save. Check your connection and try again.');
      setBusy(false);
    }
  }

  return (
    <Modal title={income ? 'Edit income' : 'Add income'} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label>Source<input type="text" value={source} onChange={(e) => setSource(e.target.value)} autoFocus placeholder="Acme payroll" /></label>
        <label>Type<select value={category} onChange={(e) => setCategory(e.target.value as IncomeCategory)}>{TYPES.map((t) => <option key={t} value={t}>{INCOME_LABELS[t]}</option>)}</select></label>
        <label>Earned by<select value={earnedBy} onChange={(e) => setEarnedBy(e.target.value)}>{members.map((m) => <option key={m.uid} value={m.uid}>{m.name}</option>)}</select></label>
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <div className="form-grid">
          <label>Currency<select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Amount<input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        </div>
        <RecurringFields value={repeat} onChange={setRepeat} editing={Boolean(income?.recurring)} />
        <label>Notes (optional)<input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row-between"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{income ? 'Save changes' : 'Save income'}</button></div>
      </form>
    </Modal>
  );
}
