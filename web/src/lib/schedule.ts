export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export const FREQUENCIES: { id: Frequency; label: string }[] = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'biweekly', label: 'Every 2 weeks' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'yearly', label: 'Yearly' },
];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };

function addMonthsClamped(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth() + n, 1);
  out.setDate(Math.min(d.getDate(), new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate()));
  return out;
}

/** Date of the occurrence after `dateStr`. The entry itself is occurrence zero. */
export function advance(dateStr: string, frequency: Frequency): string {
  const d = parse(dateStr);
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'biweekly') d.setDate(d.getDate() + 14);
  else return ymd(addMonthsClamped(parse(dateStr), frequency === 'monthly' ? 1 : 12));
  return ymd(d);
}

export const endDateAfter = (startDate: string, months: number): string => ymd(addMonthsClamped(parse(startDate), months));

/** The schedule written to Firestore, or null when repeating is off. */
export function buildSchedule(enabled: boolean, frequency: Frequency, date: string, months: number, existingEnd?: string) {
  if (!enabled) return null;
  return {
    frequency,
    nextDueDate: advance(date, frequency),
    endDate: months > 0 ? endDateAfter(date, months) : existingEnd ?? endDateAfter(date, 12),
  };
}
