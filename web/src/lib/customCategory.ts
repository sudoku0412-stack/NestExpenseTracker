import { ALL_CATEGORIES } from '@app/constants/categories';

export const MAX_CUSTOM = 20;
export const MAX_NAME = 24;
export const CUSTOM_COLORS = ['#D6336C', '#0CA678', '#F08C00', '#7048E8', '#1C7ED6', '#E8590C', '#099268', '#AE3EC9'];

export type CustomCategoryCheck =
  | { ok: true; name: string; color: string }
  | { ok: false; error: string };

/** Same name rules as Settings and the mobile custom-category store. */
export function validateCustomCategory(
  rawName: string,
  existing: { name: string }[],
): CustomCategoryCheck {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'Enter a name.' };
  if (name.length > MAX_NAME) return { ok: false, error: `Keep it to ${MAX_NAME} characters or fewer.` };
  if (existing.length >= MAX_CUSTOM) return { ok: false, error: `You can have up to ${MAX_CUSTOM} custom categories.` };
  const taken = new Set([...(ALL_CATEGORIES as string[]), ...existing.map((c) => c.name)].map((n) => n.toLowerCase()));
  if (taken.has(name.toLowerCase())) return { ok: false, error: 'A category with that name already exists.' };
  return { ok: true, name, color: CUSTOM_COLORS[existing.length % CUSTOM_COLORS.length] };
}
