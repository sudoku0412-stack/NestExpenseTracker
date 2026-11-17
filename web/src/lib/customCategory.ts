// Same limits as lib/customCategories.ts in the mobile app.
export const MAX_CUSTOM_CATEGORIES = 20;
export const MAX_CUSTOM_CATEGORY_NAME = 24;
export const CUSTOM_CATEGORY_COLORS = ['#D6336C', '#0CA678', '#F08C00', '#7048E8', '#1C7ED6', '#E8590C', '#099268', '#AE3EC9'];

export const normalizeCustomCategoryName = (name: string): string => name.trim().replace(/\s+/g, ' ');

export function customCategoryError(
  clean: string,
  existingNames: string[],
  builtinNames: string[],
): string | null {
  if (!clean) return 'Enter a name.';
  if (clean.length > MAX_CUSTOM_CATEGORY_NAME) return `Keep it to ${MAX_CUSTOM_CATEGORY_NAME} characters or fewer.`;
  if (existingNames.length >= MAX_CUSTOM_CATEGORIES) return `You can have up to ${MAX_CUSTOM_CATEGORIES} custom categories.`;
  const taken = new Set([...builtinNames, ...existingNames].map((n) => n.toLowerCase()));
  if (taken.has(clean.toLowerCase())) return 'A category with that name already exists.';
  return null;
}
