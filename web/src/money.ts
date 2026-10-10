import { formatCurrency } from '@app/lib/currency';
import { useData } from './data';

/** Format a USD-canonical amount in the user's chosen display currency. */
export function useMoney(): (amountUsd: number) => string {
  const { currency } = useData();
  return (amountUsd) => {
    const s = formatCurrency(Math.abs(amountUsd), currency);
    const [intPart, rest] = s.split('.');
    const m = intPart.match(/^(\D*)(\d+)$/);
    const grouped = m ? m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') : intPart;
    const out = rest !== undefined ? `${grouped}.${rest}` : grouped;
    // U+2212 minus: a plain hyphen lets the browser wrap the sign onto its own line.
    return amountUsd < 0 ? `\u2212${out}` : out;
  };
}
