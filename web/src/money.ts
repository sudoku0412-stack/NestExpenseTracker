import { formatCurrency } from '@app/lib/currency';
import { formatGroupedMoney } from './lib/moneyFormat';
import { useData } from './data';

/** Format a USD-canonical amount in the user's chosen display currency. */
export function useMoney(): (amountUsd: number) => string {
  const { currency } = useData();
  return (amountUsd) => formatGroupedMoney(amountUsd, formatCurrency(Math.abs(amountUsd), currency));
}
