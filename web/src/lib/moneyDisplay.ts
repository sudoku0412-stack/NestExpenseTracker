/** Group thousands and use U+2212 for negatives so the sign does not wrap onto its own line. */
export function formatGroupedCurrency(formattedAbs: string, amountUsd: number): string {
  const [intPart, rest] = formattedAbs.split('.');
  const m = intPart.match(/^(\D*)(\d+)$/);
  const grouped = m ? m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') : intPart;
  const out = rest !== undefined ? `${grouped}.${rest}` : grouped;
  return amountUsd < 0 ? `\u2212${out}` : out;
}
