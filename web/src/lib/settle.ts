import { convertEntryToUsd, type CurrencyCode } from '@app/lib/currency';

/** Empty input means settle the whole net. Typed amounts are in the display currency. */
export function settleAmountUsd(entered: string | undefined, netUsd: number, currency: CurrencyCode): number {
  return entered ? convertEntryToUsd(Number(entered), currency) : Math.abs(netUsd);
}

/** Positive net: they owe you, so they pay you. Otherwise you pay them. */
export function settlementParties(
  selfUid: string,
  memberUid: string,
  netUsd: number,
): { fromUid: string; toUid: string } {
  return netUsd > 0 ? { fromUid: memberUid, toUid: selfUid } : { fromUid: selfUid, toUid: memberUid };
}
