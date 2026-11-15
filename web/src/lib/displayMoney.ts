/**
 * Groups thousands and uses U+2212 so a leading minus cannot wrap onto its
 * own line (a plain hyphen does, which broke the dashboard KPI tiles).
 * `formattedAbs` is the already-converted display string from formatCurrency.
 */
export function formatGroupedMoney(amountUsd: number, formattedAbs: string): string {
  const [intPart, rest] = formattedAbs.split('.');
  const m = intPart.match(/^(\D*)(\d+)$/);
  const grouped = m ? m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') : intPart;
  const out = rest !== undefined ? `${grouped}.${rest}` : grouped;
  return amountUsd < 0 ? `\u2212${out}` : out;
}
