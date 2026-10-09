import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { monthName, shiftMonth } from './lib/stats';

interface Period {
  year: number;
  month: number;
  label: string;
  prev: () => void;
  next: () => void;
  today: () => void;
}
const Ctx = createContext<Period | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const value = useMemo<Period>(
    () => ({
      ...ym,
      label: monthName(ym.year, ym.month),
      prev: () => setYm((c) => shiftMonth(c.year, c.month, -1)),
      next: () => setYm((c) => shiftMonth(c.year, c.month, 1)),
      today: () => setYm({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 }),
    }),
    [ym],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePeriod(): Period {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePeriod outside PeriodProvider');
  return v;
}

export function MonthPicker() {
  const p = usePeriod();
  return (
    <div className="picker" role="group" aria-label="Month">
      <button onClick={p.prev} aria-label="Previous month">‹</button>
      <span>{p.label}</span>
      <button onClick={p.next} aria-label="Next month">›</button>
    </div>
  );
}
