import Constants from 'expo-constants';
import type { Ionicons } from '@expo/vector-icons';
import type { TranslationKey } from './i18n';

export interface WhatsNewSlide {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: TranslationKey;
  body: TranslationKey;
  premium?: boolean;
}

/** Release notes shown once, the first time a user opens that version.
 *  Add an entry per release; a version with no entry shows nothing. */
export const WHATS_NEW: Record<string, WhatsNewSlide[]> = {
  '2.0.0': [
    { key: 'categories', icon: 'pricetags-outline', title: 'wnCategoriesTitle', body: 'wnCategoriesBody', premium: true },
    { key: 'budgets', icon: 'speedometer-outline', title: 'wnBudgetsTitle', body: 'wnBudgetsBody' },
    { key: 'investments', icon: 'trending-up-outline', title: 'wnInvestmentsTitle', body: 'wnInvestmentsBody', premium: true },
    { key: 'budgetsPage', icon: 'speedometer-outline', title: 'wnBudgetsPageTitle', body: 'wnBudgetsPageBody' },
    { key: 'earnings', icon: 'pie-chart-outline', title: 'wnEarningsTitle', body: 'wnEarningsBody' },
    { key: 'currencies', icon: 'cash-outline', title: 'wnCurrenciesTitle', body: 'wnCurrenciesBody', premium: true },
    { key: 'french', icon: 'language-outline', title: 'wnFrenchTitle', body: 'wnFrenchBody' },
  ],
};

export function currentAppVersion(): string {
  return Constants.expoConfig?.version ?? '';
}

export type WhatsNewDecision = 'show' | 'mark' | 'none';

/** show: unseen version with notes. mark: unseen version without notes
 *  (record it quietly). none: already seen, or version unknown. */
export function decideWhatsNew(lastSeen: string | null, current: string): WhatsNewDecision {
  if (!current || lastSeen === current) return 'none';
  return WHATS_NEW[current]?.length ? 'show' : 'mark';
}
