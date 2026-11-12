export const roundMoney = (n: number) => Math.round(n * 100) / 100;

export function budgetAmountUsd(amountUsd: number): number {
  return Math.max(0, roundMoney(amountUsd));
}

export function goalWrite(
  goal: { name: string; targetUsd: number; allocatedUsd: number; notes?: string; createdAt?: string },
  now: string,
) {
  return {
    name: goal.name.trim(),
    targetUsd: goal.targetUsd,
    allocatedUsd: Math.max(0, goal.allocatedUsd),
    notes: goal.notes?.trim() || null,
    createdAt: goal.createdAt ?? now,
    updatedAt: now,
  };
}

export function investmentWrite(account: {
  name: string;
  kind: string;
  contributedUsd: number;
  valueUsd: number;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    name: account.name.trim(),
    kind: account.kind,
    contributedUsd: account.contributedUsd,
    valueUsd: account.valueUsd,
    notes: account.notes?.trim() || null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export function settlementWrite(fromUid: string, toUid: string, amountUsd: number, createdAt: string) {
  return { fromUid, toUid, amountUsd: roundMoney(amountUsd), createdAt };
}

/** They owe you (net > 0): they pay you. You owe them: you pay them. */
export function settlementParties(self: string, memberUid: string, netUsd: number): { fromUid: string; toUid: string } {
  return netUsd > 0 ? { fromUid: memberUid, toUid: self } : { fromUid: self, toUid: memberUid };
}
