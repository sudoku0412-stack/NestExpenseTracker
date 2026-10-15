import { formatCurrency, type CurrencyCode } from '@app/lib/currency';

/**
 * Format a USD-canonical amount for the website. Groups thousands and uses
 * U+2212 so a leading minus cannot wrap onto its own line.
 */
export function formatDisplayMoney(amountUsd: number, currency: CurrencyCode): string {
  const s = formatCurrency(Math.abs(amountUsd), currency);
  const [intPart, rest] = s.split('.');
  const m = intPart.match(/^(\D*)(\d+)$/);
  const grouped = m ? m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') : intPart;
  const out = rest !== undefined ? `${grouped}.${rest}` : grouped;
  return amountUsd < 0 ? `\u2212${out}` : out;
}
