/** netUsd > 0 means the other member owes you, so they pay you. Otherwise you pay them. */
export function settlementParties(
  selfUid: string,
  memberUid: string,
  netUsd: number,
): { fromUid: string; toUid: string } {
  return netUsd > 0 ? { fromUid: memberUid, toUid: selfUid } : { fromUid: selfUid, toUid: memberUid };
}

export function settlementAmountUsd(entered: string | undefined, netUsd: number, toUsd: (n: number) => number): number {
  return entered ? toUsd(Number(entered)) : Math.abs(netUsd);
}
