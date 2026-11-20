export const MAX_CUSTOM_CATEGORIES = 20;
export const MAX_CUSTOM_CATEGORY_NAME = 24;
export const CUSTOM_CATEGORY_COLORS = ['#D6336C', '#0CA678', '#F08C00', '#7048E8', '#1C7ED6', '#E8590C', '#099268', '#AE3EC9'];

export type CategoryNameResult = { ok: true; clean: string } | { ok: false; error: string };

/** Same name rules as Settings on the web and lib/customCategories on mobile. */
export function validateCustomCategoryName(
  name: string,
  existing: string[],
  builtins: readonly string[],
): CategoryNameResult {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return { ok: false, error: 'Enter a name.' };
  if (clean.length > MAX_CUSTOM_CATEGORY_NAME) {
    return { ok: false, error: `Keep it to ${MAX_CUSTOM_CATEGORY_NAME} characters or fewer.` };
  }
  if (existing.length >= MAX_CUSTOM_CATEGORIES) {
    return { ok: false, error: `You can have up to ${MAX_CUSTOM_CATEGORIES} custom categories.` };
  }
  const taken = new Set([...builtins, ...existing].map((n) => n.toLowerCase()));
  if (taken.has(clean.toLowerCase())) return { ok: false, error: 'A category with that name already exists.' };
  return { ok: true, clean };
}

export function nextCustomCategoryColor(existingCount: number): string {
  return CUSTOM_CATEGORY_COLORS[existingCount % CUSTOM_CATEGORY_COLORS.length];
}
