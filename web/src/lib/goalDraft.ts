import { convertEntryToUsd, type CurrencyCode } from '@app/lib/currency';

export type GoalFormResult =
  | { ok: true; name: string; targetUsd: number; notes: string }
  | { ok: false; error: string };

/** New/edit savings-goal form: name required, target must be > 0, amounts stored in USD. */
export function parseGoalForm(input: {
  name: string;
  targetText: string;
  notes: string;
  currency: CurrencyCode;
}): GoalFormResult {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Give the goal a name.' };
  const n = Number(input.targetText);
  if (!(n > 0)) return { ok: false, error: 'Enter a target amount greater than zero.' };
  return { ok: true, name, targetUsd: convertEntryToUsd(n, input.currency), notes: input.notes };
}

export function parsePositiveDisplayAmount(text: string | undefined): number | null {
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Add or take out, never below zero — same clamp saveGoal writes to Firestore. */
export function nextAllocatedUsd(currentUsd: number, signedDeltaUsd: number): number {
  return Math.max(0, currentUsd + signedDeltaUsd);
}
