/** Direction of a Settle-up write. `netUsd` is what `memberUid` owes `selfUid`
 *  (positive → they pay you; negative → you pay them). */
export function settlementParties(
  selfUid: string,
  memberUid: string,
  netUsd: number,
): { fromUid: string; toUid: string } {
  return netUsd > 0
    ? { fromUid: memberUid, toUid: selfUid }
    : { fromUid: selfUid, toUid: memberUid };
}

/** Typed amount in the display currency, or the full outstanding balance. */
export function settlementAmountUsd(
  entered: string | undefined,
  netUsd: number,
  convertEntered: (n: number) => number,
): number {
  return entered ? convertEntered(Number(entered)) : Math.abs(netUsd);
}
