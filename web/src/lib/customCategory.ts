// Same limits and colour cycle as lib/customCategories.ts — do not import that
// module here; it pulls expo-secure-store into the web bundle.
export const MAX_CUSTOM = 20;
export const MAX_NAME = 24;
export const CUSTOM_COLORS = ['#D6336C', '#0CA678', '#F08C00', '#7048E8', '#1C7ED6', '#E8590C', '#099268', '#AE3EC9'];

export function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function validateCustomCategoryName(
  name: string,
  existing: string[],
  builtIn: string[],
): string | null {
  const clean = normalizeCategoryName(name);
  if (!clean) return 'Enter a name.';
  if (clean.length > MAX_NAME) return `Keep it to ${MAX_NAME} characters or fewer.`;
  if (existing.length >= MAX_CUSTOM) return `You can have up to ${MAX_CUSTOM} custom categories.`;
  const taken = new Set([...builtIn, ...existing].map((n) => n.toLowerCase()));
  if (taken.has(clean.toLowerCase())) return 'A category with that name already exists.';
  return null;
}
