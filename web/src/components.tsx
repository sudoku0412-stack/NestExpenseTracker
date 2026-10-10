import { useEffect, type ReactNode } from 'react';
import { FREQUENCIES, type Frequency } from './lib/schedule';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="drawer-bg" style={{ alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflow: 'auto' }} onClick={onClose}>
      <div className="modal" style={{ width: wide ? 'min(720px, 100%)' : undefined, margin: '24px auto' }} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row-between"><h1>{title}</h1><button type="button" className="btn sm" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

export interface RecurringState { enabled: boolean; frequency: Frequency; months: string }
export const NO_REPEAT: RecurringState = { enabled: false, frequency: 'monthly', months: '12' };

export function RecurringFields({ value, onChange, editing }: { value: RecurringState; onChange: (v: RecurringState) => void; editing?: boolean }) {
  return (
    <div className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
      <label className="switch-row"><span>Repeat automatically</span>
        <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} /></label>
      {value.enabled && (
        <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
          <select value={value.frequency} onChange={(e) => onChange({ ...value, frequency: e.target.value as Frequency })} aria-label="Frequency">
            {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <input type="number" min="1" step="1" style={{ width: 150 }} placeholder={editing ? 'Keep end date' : 'Months to repeat'} value={value.months}
            onChange={(e) => onChange({ ...value, months: e.target.value })} aria-label="Months to repeat" />
        </div>
      )}
    </div>
  );
}
