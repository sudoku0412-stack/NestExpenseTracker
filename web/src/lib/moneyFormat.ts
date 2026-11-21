/** Group thousands and use a non-wrapping minus (U+2212). `formattedAbs` is formatCurrency(abs). */
export function formatGroupedMoney(amountUsd: number, formattedAbs: string): string {
  const [intPart, rest] = formattedAbs.split('.');
  const m = intPart.match(/^(\D*)(\d+)$/);
  const grouped = m ? m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') : intPart;
  const out = rest !== undefined ? `${grouped}.${rest}` : grouped;
  return amountUsd < 0 ? `\u2212${out}` : out;
}
