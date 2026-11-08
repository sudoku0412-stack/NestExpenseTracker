import { formatCurrency } from '@app/lib/currency';
import { useData } from './data';
import { formatGroupedCurrency } from './lib/moneyDisplay';

/** Format a USD-canonical amount in the user's chosen display currency. */
export function useMoney(): (amountUsd: number) => string {
  const { currency } = useData();
  return (amountUsd) => formatGroupedCurrency(formatCurrency(Math.abs(amountUsd), currency), amountUsd);
}
