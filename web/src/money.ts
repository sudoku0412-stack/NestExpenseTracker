import { useData } from './data';
import { formatDisplayMoney } from './lib/displayMoney';

/** Format a USD-canonical amount in the user's chosen display currency. */
export function useMoney(): (amountUsd: number) => string {
  const { currency } = useData();
  return (amountUsd) => formatDisplayMoney(amountUsd, currency);
}
