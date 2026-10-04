import { ALL_CATEGORIES, CATEGORY_ICONS, categoryIcon } from '../constants/categories';

describe('categoryIcon', () => {
  it('returns the built-in glyph for every standard category', () => {
    for (const name of ALL_CATEGORIES) {
      expect(categoryIcon(name)).toBe(CATEGORY_ICONS[name]);
    }
  });

  it('uses the fallback for custom and unknown names (history/dashboard rows)', () => {
    expect(categoryIcon('Subscriptions')).toBe('🏷️');
    expect(categoryIcon('Subscriptions', '🧾')).toBe('🧾');
    expect(categoryIcon('Pets', '🔁')).toBe('🔁');
  });
});
