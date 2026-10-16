import { Category, Receipt } from '../types';
import { isInCalendarRange } from './calendarDate';
import { CurrencyCode, convertFromUsd, currencyDecimals } from './currency';

/**
 * Pure analytics over a list of receipts. None of these functions
 * touch the database directly — pass them whatever subset of receipts
 * you want analyzed (typically the result of getAllReceipts()).
 *
 * All amounts use raw signed item sums (matching the dashboard's
 * post-fix behavior — see lib/dashboardStats.ts) so category totals
 * are internally consistent across screens.
 */

export type MonthBucket = {
  /** "2026-05" — convenient ISO-like key for grouping. */
  key: string;
  year: number;
  month: number; // 1-12
  /** "May 2026" — humanized label for chart axes. */
  label: string;
  /** "May" — short label for compact charts. */
  shortLabel: string;
  total: number;
  receiptCount: number;
};

export type MonthlySummary = {
  year: number;
  month: number;
  total: number;
  receiptCount: number;
  /** Sorted descending by total. */
  categories: Array<{ category: Category | string; total: number }>;
  topCategory: { category: Category | string; total: number } | null;
  avgPerReceipt: number;
  biggestReceipt: {
    receiptId: string;
    storeName: string;
    date: string;
    total: number;
  } | null;
  biggestItem: {
    receiptId: string;
    storeName: string;
    itemName: string;
    amount: number;
  } | null;
};

export type MonthOverMonthDelta = {
  thisMonth: MonthlySummary;
  prevMonth: MonthlySummary;
  /** Absolute change (thisMonth.total - prevMonth.total). */
  delta: number;
  /** Percentage change as a fraction (0.15 = +15%). null when prevMonth had no spend. */
  deltaPct: number | null;
};

/** Summary of an arbitrary date range — superset of MonthlySummary
 *  that the Reports screen uses for any preset or custom range. */
export type RangeSummary = {
  start: Date;
  end: Date;
  total: number;
  receiptCount: number;
  categories: Array<{ category: Category | string; total: number }>;
  topCategory: { category: Category | string; total: number } | null;
  avgPerReceipt: number;
  biggestReceipt: {
    receiptId: string;
    storeName: string;
    date: string;
    total: number;
  } | null;
  biggestItem: {
    receiptId: string;
    storeName: string;
    itemName: string;
    amount: number;
  } | null;
};

export type PeriodDelta = {
  current: RangeSummary;
  previous: RangeSummary;
  delta: number;
  deltaPct: number | null;
};

export type TopStore = {
  storeName: string;
  total: number;
  count: number;
};

export type CategoryTrendPoint = {
  key: string;
  shortLabel: string;
  total: number;
};

export type CategoryTrend = {
  category: Category | string;
  /** Monthly bucket totals for this category, oldest → newest. */
  points: CategoryTrendPoint[];
  /** Sum across all points in the window. */
  windowTotal: number;
  /** Last point's total. */
  thisMonth: number;
  /** Second-to-last point's total. */
  prevMonth: number;
  /** thisMonth - prevMonth. */
  delta: number;
};

export type RecurringMatch = {
  /** Normalized label — store name for store-level matches, lowercase
   *  cleaned name for item-level matches. */
  label: string;
  /** "store" → this merchant appears across multiple months.
   *  "item" → the same item name appears across multiple months. */
  kind: 'store' | 'item';
  /** Distinct month keys ("2026-04", "2026-05", …) the match was
   *  observed in. */
  monthKeys: string[];
  /** Number of times observed across all months (not unique months). */
  occurrences: number;
  /** Sum of amounts (item amounts for kind='item', receipt totals for
   *  kind='store') across all occurrences. */
  total: number;
  /** Sample human-readable name to show in the UI — the most recent
   *  full label seen (preserves original casing). */
  displayName: string;
};

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthLabel(year: number, month: number): string {
  return `${MONTH_SHORT[month - 1]} ${year}`;
}

function getReceiptYearMonth(r: Receipt): { year: number; month: number } {
  const d = new Date(r.date);
  // Use LOCAL time — matches the rest of the app's wall-clock semantics
  // since lib/parser.ts now constructs dates in local time.
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function categoryTotalsFor(receipts: Receipt[]): Map<string, number> {
  // Same aggregation policy as lib/dashboardStats.ts: signed item-level
  // sums when items exist, else the receipt's primary category total.
  //
  // Line items are pre-tax, but the screen's headline total (see
  // summarizeMonth/summarizeRange below) sums r.totalAmount, which
  // includes tax — summing raw item amounts here made the "By category"
  // breakdown never add up to the headline number. Scale each receipt's
  // item amounts by (totalAmount / itemSum) so tax/rounding gets
  // distributed proportionally across its categories and the breakdown
  // reconciles exactly, while per-category proportions are unchanged.
  const m = new Map<string, number>();
  for (const r of receipts) {
    if (r.lineItems && r.lineItems.length > 0) {
      const itemSum = r.lineItems.reduce((s, it) => s + it.amount, 0);
      const scale = itemSum !== 0 ? r.totalAmount / itemSum : 1;
      for (const it of r.lineItems) {
        const cat = (it.category ?? r.category) as string;
        m.set(cat, (m.get(cat) ?? 0) + it.amount * scale);
      }
    } else {
      const cat = r.category as string;
      m.set(cat, (m.get(cat) ?? 0) + r.totalAmount);
    }
  }
  return m;
}

/**
 * Summarize one specific calendar month worth of receipts.
 * Caller is responsible for filtering down to that month — typically
 * `getReceiptsByMonth(year, month)` or filtering the full list.
 */
export function summarizeMonth(
  receipts: Receipt[],
  year: number,
  month: number,
): MonthlySummary {
  const total = receipts.reduce((s, r) => s + r.totalAmount, 0);
  const receiptCount = receipts.length;

  const catMap = categoryTotalsFor(receipts);
  const categories = Array.from(catMap.entries())
    .map(([category, t]) => ({ category, total: t }))
    .sort((a, b) => b.total - a.total);
  const topCategory = categories[0] ?? null;

  let biggestReceipt: MonthlySummary['biggestReceipt'] = null;
  for (const r of receipts) {
    if (!biggestReceipt || r.totalAmount > biggestReceipt.total) {
      biggestReceipt = {
        receiptId: r.id,
        storeName: r.storeName,
        date: r.date,
        total: r.totalAmount,
      };
    }
  }

  let biggestItem: MonthlySummary['biggestItem'] = null;
  for (const r of receipts) {
    if (!r.lineItems) continue;
    for (const it of r.lineItems) {
      // Discount/markdown lines (negative amounts) are not the
      // "biggest single purchase" — skip them.
      if (it.amount <= 0) continue;
      if (!biggestItem || it.amount > biggestItem.amount) {
        biggestItem = {
          receiptId: r.id,
          storeName: r.storeName,
          itemName: it.name,
          amount: it.amount,
        };
      }
    }
  }

  return {
    year,
    month,
    total,
    receiptCount,
    categories,
    topCategory,
    avgPerReceipt: receiptCount > 0 ? total / receiptCount : 0,
    biggestReceipt,
    biggestItem,
  };
}

/**
 * Filter the receipts that fall within [start, end] (inclusive on
 * both ends, day-level granularity in LOCAL time).
 */
/** Any dated row (receipts, incomes) inside [start, end] on the civil calendar. */
export function filterDatedInRange<T extends { date: string }>(
  rows: T[],
  start: Date,
  end: Date,
): T[] {
  return rows.filter((r) => isInCalendarRange(r.date, start, end));
}

export function filterReceiptsInRange(
  receipts: Receipt[],
  start: Date,
  end: Date,
): Receipt[] {
  return filterDatedInRange(receipts, start, end);
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/**
 * Summarize an arbitrary date range. The contract mirrors summarizeMonth
 * (top categories, biggest receipt, biggest item, etc.) but spans
 * however many days/months the caller passes in.
 */
export function summarizeRange(
  receipts: Receipt[],
  start: Date,
  end: Date,
): RangeSummary {
  const scoped = filterReceiptsInRange(receipts, start, end);
  const total = scoped.reduce((s, r) => s + r.totalAmount, 0);
  const receiptCount = scoped.length;
  const catMap = categoryTotalsFor(scoped);
  const categories = Array.from(catMap.entries())
    .map(([category, t]) => ({ category, total: t }))
    .sort((a, b) => b.total - a.total);
  const topCategory = categories[0] ?? null;

  let biggestReceipt: RangeSummary['biggestReceipt'] = null;
  for (const r of scoped) {
    if (!biggestReceipt || r.totalAmount > biggestReceipt.total) {
      biggestReceipt = {
        receiptId: r.id,
        storeName: r.storeName,
        date: r.date,
        total: r.totalAmount,
      };
    }
  }

  let biggestItem: RangeSummary['biggestItem'] = null;
  for (const r of scoped) {
    if (!r.lineItems) continue;
    for (const it of r.lineItems) {
      if (it.amount <= 0) continue;
      if (!biggestItem || it.amount > biggestItem.amount) {
        biggestItem = {
          receiptId: r.id,
          storeName: r.storeName,
          itemName: it.name,
          amount: it.amount,
        };
      }
    }
  }

  return {
    start: startOfLocalDay(start),
    end: endOfLocalDay(end),
    total,
    receiptCount,
    categories,
    topCategory,
    avgPerReceipt: receiptCount > 0 ? total / receiptCount : 0,
    biggestReceipt,
    biggestItem,
  };
}

/**
 * Compare the given range to the immediately-preceding window of the
 * same length. e.g. May 1-31 → April 1-30 (31 days back). Returns the
 * absolute and percentage change in total spend.
 */
export function periodOverPeriodDelta(
  receipts: Receipt[],
  start: Date,
  end: Date,
): PeriodDelta {
  const s = startOfLocalDay(start);
  const e = endOfLocalDay(end);
  const lengthMs = e.getTime() - s.getTime();
  const prevEnd = new Date(s.getTime() - 1); // 1ms before start
  const prevStart = new Date(prevEnd.getTime() - lengthMs);
  const current = summarizeRange(receipts, s, e);
  const previous = summarizeRange(receipts, prevStart, prevEnd);
  const delta = current.total - previous.total;
  const deltaPct = previous.total > 0 ? delta / previous.total : null;
  return { current, previous, delta, deltaPct };
}

/**
 * Compare a given month against the immediately preceding month and
 * return the delta + percentage change.
 */
export function monthOverMonthDelta(
  allReceipts: Receipt[],
  year: number,
  month: number,
): MonthOverMonthDelta {
  const buckets = bucketByMonth(allReceipts);
  const thisKey = monthKey(year, month);
  const prevDate = new Date(year, month - 2, 1); // month is 1-indexed; subtract 1 to go back, then -1 for ctor
  const prevYear = prevDate.getFullYear();
  const prevMonth = prevDate.getMonth() + 1;
  const prevKey = monthKey(prevYear, prevMonth);

  const thisRs = buckets.get(thisKey) ?? [];
  const prevRs = buckets.get(prevKey) ?? [];
  const thisMonth = summarizeMonth(thisRs, year, month);
  const prevMonthSum = summarizeMonth(prevRs, prevYear, prevMonth);

  const delta = thisMonth.total - prevMonthSum.total;
  const deltaPct =
    prevMonthSum.total > 0 ? delta / prevMonthSum.total : null;

  return {
    thisMonth,
    prevMonth: prevMonthSum,
    delta,
    deltaPct,
  };
}

function bucketByMonth(receipts: Receipt[]): Map<string, Receipt[]> {
  const m = new Map<string, Receipt[]>();
  for (const r of receipts) {
    const { year, month } = getReceiptYearMonth(r);
    const key = monthKey(year, month);
    const list = m.get(key);
    if (list) list.push(r);
    else m.set(key, [r]);
  }
  return m;
}

/**
 * Build a chronological list of `monthsBack` consecutive month buckets
 * ending at `(year, month)`. Months with no receipts are included with
 * a zero total so the chart shows continuous time.
 */
export function monthlyTrend(
  receipts: Receipt[],
  year: number,
  month: number,
  monthsBack = 6,
): MonthBucket[] {
  const buckets = bucketByMonth(receipts);
  const out: MonthBucket[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    const y = d.getFullYear();
    const mo = d.getMonth() + 1;
    const key = monthKey(y, mo);
    const list = buckets.get(key) ?? [];
    const total = list.reduce((s, r) => s + r.totalAmount, 0);
    out.push({
      key,
      year: y,
      month: mo,
      label: monthLabel(y, mo),
      shortLabel: MONTH_SHORT[mo - 1],
      total,
      receiptCount: list.length,
    });
  }
  return out;
}

/**
 * Top N stores across the given receipts by total spend. Ties broken
 * by visit count, then alphabetical.
 */
export function topStores(
  receipts: Receipt[],
  limit = 5,
): TopStore[] {
  const m = new Map<string, { total: number; count: number }>();
  for (const r of receipts) {
    const key = r.storeName.trim() || 'Unknown Store';
    const entry = m.get(key) ?? { total: 0, count: 0 };
    entry.total += r.totalAmount;
    entry.count += 1;
    m.set(key, entry);
  }
  return Array.from(m.entries())
    .map(([storeName, { total, count }]) => ({ storeName, total, count }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.count !== a.count) return b.count - a.count;
      return a.storeName.localeCompare(b.storeName);
    })
    .slice(0, limit);
}

/**
 * Per-category trend: for the top N categories across the window,
 * return the monthly time series so the UI can render a sparkline or
 * mini bar chart and a "this vs last month" delta.
 *
 * The N categories are chosen by total spend in the window, so a
 * tiny once-off category doesn't crowd out a frequently used one.
 */
export function categoryTrends(
  receipts: Receipt[],
  year: number,
  month: number,
  monthsBack = 6,
  topN = 4,
): CategoryTrend[] {
  // Pre-compute the month-key window so each category aggregator
  // sees the same buckets in the same order.
  const windowKeys: Array<{ key: string; shortLabel: string }> = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    windowKeys.push({
      key: monthKey(d.getFullYear(), d.getMonth() + 1),
      shortLabel: MONTH_SHORT[d.getMonth()],
    });
  }
  const windowKeySet = new Set(windowKeys.map((w) => w.key));

  // For each (category, month-key), sum signed item amounts.
  const grid = new Map<string, Map<string, number>>();
  const categoryTotalsAll = new Map<string, number>();
  for (const r of receipts) {
    const { year: ry, month: rm } = getReceiptYearMonth(r);
    const rKey = monthKey(ry, rm);
    if (!windowKeySet.has(rKey)) continue;
    const contribute = (cat: string, amount: number) => {
      if (!grid.has(cat)) grid.set(cat, new Map());
      const inner = grid.get(cat)!;
      inner.set(rKey, (inner.get(rKey) ?? 0) + amount);
      categoryTotalsAll.set(cat, (categoryTotalsAll.get(cat) ?? 0) + amount);
    };
    if (r.lineItems && r.lineItems.length > 0) {
      for (const it of r.lineItems) {
        const cat = (it.category ?? r.category) as string;
        contribute(cat, it.amount);
      }
    } else {
      contribute(r.category as string, r.totalAmount);
    }
  }

  // Rank categories by their total in the window, take top N.
  const topCategories = Array.from(categoryTotalsAll.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([cat]) => cat);

  return topCategories.map((cat) => {
    const inner = grid.get(cat) ?? new Map();
    const points: CategoryTrendPoint[] = windowKeys.map(({ key, shortLabel }) => ({
      key,
      shortLabel,
      total: inner.get(key) ?? 0,
    }));
    const windowTotal = points.reduce((s, p) => s + p.total, 0);
    const thisMonth = points[points.length - 1]?.total ?? 0;
    const prevMonth = points[points.length - 2]?.total ?? 0;
    return {
      category: cat,
      points,
      windowTotal,
      thisMonth,
      prevMonth,
      delta: thisMonth - prevMonth,
    };
  });
}

/** Normalize an item name for recurring detection. Strips common
 *  variants so "ORG MILK 2%" and "ORG MILK 1%" can group together
 *  by store-level recurrence even with slight wording differences. */
function normalizeItemName(name: string): string {
  return name
    .toLowerCase()
    // Strip qty/weight + percentages FIRST, while their markers
    // (%, lb, kg, etc.) are still present in the string. A later
    // punctuation pass would remove the symbols, defeating these
    // patterns, so order matters here.
    .replace(/\b\d+(?:\.\d+)?\s*%/g, ' ')
    .replace(
      /\b\d+(?:\.\d+)?\s*(?:lb|oz|kg|g|ml|l|ct|pk|pack|count)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9 ]+/g, ' ') // drop remaining punctuation
    .replace(/\b\d+(?:\.\d+)?\b/g, ' ') // bare numbers (sizes etc.)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect items/stores that recur across multiple months — subscriptions,
 * regular fuel runs, weekly grocery staples, etc.
 *
 * A match must appear in ≥ `minMonths` distinct calendar months within
 * the receipts list. Stores are matched by storeName; items are matched
 * by the normalized name (case-insensitive, weight/qty stripped) AND
 * must always come from the same store, to avoid coincidental name
 * collisions across merchants.
 *
 * Sorted by (most months seen) desc, then total spend desc.
 */
export function findRecurring(
  receipts: Receipt[],
  minMonths = 3,
): RecurringMatch[] {
  // Store-level recurrence.
  const storeAcc = new Map<
    string,
    {
      displayName: string;
      months: Set<string>;
      occurrences: number;
      total: number;
    }
  >();
  // Item-level recurrence — key is "store|normalizedItemName".
  const itemAcc = new Map<
    string,
    {
      displayName: string;
      months: Set<string>;
      occurrences: number;
      total: number;
    }
  >();

  for (const r of receipts) {
    const storeKey = r.storeName.trim().toLowerCase() || 'unknown store';
    const displayStore = r.storeName.trim() || 'Unknown Store';
    const { year, month } = getReceiptYearMonth(r);
    const mKey = monthKey(year, month);

    const sEntry = storeAcc.get(storeKey) ?? {
      displayName: displayStore,
      months: new Set<string>(),
      occurrences: 0,
      total: 0,
    };
    sEntry.displayName = displayStore;
    sEntry.months.add(mKey);
    sEntry.occurrences += 1;
    sEntry.total += r.totalAmount;
    storeAcc.set(storeKey, sEntry);

    if (r.lineItems) {
      for (const it of r.lineItems) {
        if (it.amount <= 0) continue; // skip discounts
        const normalized = normalizeItemName(it.name);
        if (normalized.length < 3) continue;
        const itemKey = `${storeKey}|${normalized}`;
        const iEntry = itemAcc.get(itemKey) ?? {
          displayName: `${it.name.trim()} (${displayStore})`,
          months: new Set<string>(),
          occurrences: 0,
          total: 0,
        };
        iEntry.displayName = `${it.name.trim()} (${displayStore})`;
        iEntry.months.add(mKey);
        iEntry.occurrences += 1;
        iEntry.total += it.amount;
        itemAcc.set(itemKey, iEntry);
      }
    }
  }

  const out: RecurringMatch[] = [];
  for (const [label, e] of storeAcc.entries()) {
    if (e.months.size >= minMonths) {
      out.push({
        label,
        kind: 'store',
        monthKeys: Array.from(e.months).sort(),
        occurrences: e.occurrences,
        total: e.total,
        displayName: e.displayName,
      });
    }
  }
  for (const [label, e] of itemAcc.entries()) {
    if (e.months.size >= minMonths) {
      out.push({
        label,
        kind: 'item',
        monthKeys: Array.from(e.months).sort(),
        occurrences: e.occurrences,
        total: e.total,
        displayName: e.displayName,
      });
    }
  }
  return out.sort((a, b) => {
    if (b.monthKeys.length !== a.monthKeys.length) {
      return b.monthKeys.length - a.monthKeys.length;
    }
    return b.total - a.total;
  });
}

/**
 * Serialize a list of receipts to CSV text. Each line item becomes
 * one row; receipts without line items get a single row with the
 * receipt total in the item-amount column.
 *
 * Columns: Date, Store, Total, Subtotal, Tax, ItemName, ItemAmount,
 * ItemCategory, ReceiptCategoryTags, Notes.
 */
export function receiptsToCsv(receipts: Receipt[], currency: CurrencyCode = 'USD'): string {
  // Every stored amount is USD-canonical — convert once here so the
  // export matches whatever currency the app is showing, instead of
  // always dumping raw USD regardless of the user's selection.
  const money = (n: number) => convertFromUsd(n, currency).toFixed(currencyDecimals(currency));
  const header = [
    'Date',
    'Store',
    'Currency',
    'ReceiptTotal',
    'Subtotal',
    'Tax',
    'ItemName',
    'ItemAmount',
    'ItemCategory',
    'ReceiptCategoryTags',
    'Notes',
  ].join(',');
  const rows: string[] = [header];

  // Sort chronologically so the CSV reads top-to-bottom oldest-to-newest.
  const sorted = [...receipts].sort((a, b) => a.date.localeCompare(b.date));
  for (const r of sorted) {
    const dateOnly = r.date.slice(0, 10);
    const tags = (r.categoryTags ?? [r.category]).join('; ');
    const base = [
      dateOnly,
      csvEscape(r.storeName),
      currency,
      money(r.totalAmount),
      r.subtotalAmount != null ? money(r.subtotalAmount) : '',
      r.taxAmount != null ? money(r.taxAmount) : '',
    ];
    if (r.lineItems && r.lineItems.length > 0) {
      for (const it of r.lineItems) {
        rows.push(
          [
            ...base,
            csvEscape(it.name),
            money(it.amount),
            csvEscape((it.category ?? '') as string),
            csvEscape(tags),
            csvEscape(r.notes ?? ''),
          ].join(','),
        );
      }
    } else {
      rows.push(
        [
          ...base,
          '',
          '',
          csvEscape(r.category as string),
          csvEscape(tags),
          csvEscape(r.notes ?? ''),
        ].join(','),
      );
    }
  }

  return rows.join('\n');
}

function csvEscape(value: string): string {
  if (value == null) return '';
  const needsQuoting = /[",\n\r]/.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
