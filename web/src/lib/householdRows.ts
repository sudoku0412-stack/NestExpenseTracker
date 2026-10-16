import type { SavingsGoal, Settlement } from '@app/types';

type Doc = Record<string, unknown>;

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function toSettlement(id: string, d: Doc, householdId: string): Settlement {
  return {
    id,
    fromUid: str(d.fromUid),
    toUid: str(d.toUid),
    amountUsd: num(d.amountUsd),
    createdAt: str(d.createdAt),
    householdId,
  };
}

export function toGoal(id: string, d: Doc, householdId: string): SavingsGoal {
  return {
    id,
    name: str(d.name),
    targetUsd: num(d.targetUsd),
    allocatedUsd: num(d.allocatedUsd),
    notes: typeof d.notes === 'string' ? d.notes : undefined,
    householdId,
    createdAt: str(d.createdAt),
    updatedAt: str(d.updatedAt),
  };
}
