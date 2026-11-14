export type SplitMethod = 'equal' | 'percent' | 'amount' | 'shares';

export function receiptFormError(input: {
  store: string;
  total: number;
  tags: string[];
  items: { name: string; amount: string }[];
  splitOn: boolean;
  people: string[];
  method: SplitMethod;
  vals: Record<string, string>;
}): string | null {
  if (!input.store.trim()) return 'Enter the store name.';
  if (!(input.total > 0)) return 'Enter a total greater than zero.';
  if (input.tags.length === 0) return 'Pick at least one category.';
  if (input.items.some((i) => !i.name.trim() || !(Number(i.amount) !== 0 && Number.isFinite(Number(i.amount))))) {
    return 'Each item needs a name and an amount.';
  }
  if (input.splitOn) {
    if (input.people.length < 2) return 'Choose at least two people to split with.';
    const v: Record<string, number> = {};
    if (input.method !== 'equal') for (const p of input.people) v[p] = Number(input.vals[p]) || 0;
    if (input.method === 'percent' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - 100) > 0.01) {
      return 'Percentages must add up to 100.';
    }
    if (input.method === 'amount' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - input.total) > 0.01) {
      return 'Amounts must add up to the total.';
    }
    if (input.method === 'shares' && Object.values(v).every((x) => x <= 0)) {
      return 'Give at least one person a share.';
    }
  }
  return null;
}

export function incomeFormError(source: string, amount: number, earnedBy: string): string | null {
  if (!source.trim()) return 'Enter where the money came from.';
  if (!(amount > 0)) return 'Enter an amount greater than zero.';
  if (!earnedBy) return 'Choose who earned it.';
  return null;
}
