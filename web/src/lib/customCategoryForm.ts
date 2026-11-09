export const MAX_CUSTOM = 20;
export const MAX_NAME = 24;
export const CUSTOM_COLORS = ['#D6336C', '#0CA678', '#F08C00', '#7048E8', '#1C7ED6', '#E8590C', '#099268', '#AE3EC9'];

export type CustomCategoryError = 'empty' | 'tooLong' | 'duplicate' | 'limit';

export function cleanCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function validateCustomCategory(
  name: string,
  existingNames: string[],
  builtinNames: string[],
): { ok: true; clean: string } | { ok: false; reason: CustomCategoryError } {
  const clean = cleanCategoryName(name);
  if (!clean) return { ok: false, reason: 'empty' };
  if (clean.length > MAX_NAME) return { ok: false, reason: 'tooLong' };
  if (existingNames.length >= MAX_CUSTOM) return { ok: false, reason: 'limit' };
  const taken = new Set([...builtinNames, ...existingNames].map((n) => n.toLowerCase()));
  if (taken.has(clean.toLowerCase())) return { ok: false, reason: 'duplicate' };
  return { ok: true, clean };
}

export const customCategoryMessage: Record<CustomCategoryError, string> = {
  empty: 'Enter a name.',
  tooLong: `Keep it to ${MAX_NAME} characters or fewer.`,
  duplicate: 'A category with that name already exists.',
  limit: `You can have up to ${MAX_CUSTOM} custom categories.`,
};

export function nextCustomColor(existingCount: number): string {
  return CUSTOM_COLORS[existingCount % CUSTOM_COLORS.length];
}

export function clampBudgetUsd(amountUsd: number): number {
  return Math.max(0, Math.round(amountUsd * 100) / 100);
}

export function roundUsd(amountUsd: number): number {
  return Math.round(amountUsd * 100) / 100;
}
