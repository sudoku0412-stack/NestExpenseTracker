import { formatCurrency } from '@app/lib/currency';
import { useData } from './data';
import { formatGroupedMoney } from './lib/displayMoney';

/** Format a USD-canonical amount in the user's chosen display currency. */
export function useMoney(): (amountUsd: number) => string {
  const { currency } = useData();
  return (amountUsd) => formatGroupedMoney(amountUsd, formatCurrency(Math.abs(amountUsd), currency));
}
