import {
  summarizeMonth,
  monthOverMonthDelta,
  monthlyTrend,
  topStores,
  categoryTrends,
  findRecurring,
  receiptsToCsv,
  summarizeRange,
  periodOverPeriodDelta,
  filterDatedInRange,
  filterReceiptsInRange,
} from '../lib/reports';
import { Receipt } from '../types';

const baseReceipt = (overrides: Partial<Receipt>): Receipt => ({
  id: Math.random().toString(36).slice(2),
  storeName: 'Test',
  date: '2026-05-15T00:00:00.000Z',
  totalAmount: 0,
  category: 'Other',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// Build a local-midnight ISO so the timezone-aware getReceiptYearMonth
// inside reports.ts puts the receipt in the expected wall-clock month
// regardless of where the test machine sits.
const localIso = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d).toISOString();

describe('summarizeMonth', () => {
  it('returns zeros for an empty month', () => {
    const s = summarizeMonth([], 2026, 5);
    expect(s.total).toBe(0);
    expect(s.receiptCount).toBe(0);
    expect(s.categories).toEqual([]);
    expect(s.topCategory).toBeNull();
    expect(s.biggestReceipt).toBeNull();
    expect(s.biggestItem).toBeNull();
    expect(s.avgPerReceipt).toBe(0);
  });

  it('computes total, count, and average', () => {
    const s = summarizeMonth(
      [
        baseReceipt({ id: 'a', totalAmount: 50 }),
        baseReceipt({ id: 'b', totalAmount: 150 }),
      ],
      2026,
      5,
    );
    expect(s.total).toBe(200);
    expect(s.receiptCount).toBe(2);
    expect(s.avgPerReceipt).toBe(100);
  });

  it('picks the biggest receipt by total', () => {
    const s = summarizeMonth(
      [
        baseReceipt({ id: 'a', totalAmount: 50, storeName: 'Small' }),
        baseReceipt({ id: 'b', totalAmount: 257.05, storeName: 'Skechers' }),
        baseReceipt({ id: 'c', totalAmount: 100, storeName: 'Mid' }),
      ],
      2026,
      5,
    );
    expect(s.biggestReceipt).toEqual({
      receiptId: 'b',
      storeName: 'Skechers',
      date: expect.any(String),
      total: 257.05,
    });
  });

  it('picks the biggest non-discount line item across all receipts', () => {
    const s = summarizeMonth(
      [
        baseReceipt({
          id: 'r1',
          storeName: 'Costco',
          totalAmount: 100,
          lineItems: [
            { id: '1', name: 'Milk', amount: 5 },
            { id: '2', name: 'EKO MIRROR', amount: 69.99 },
          ],
        }),
        baseReceipt({
          id: 'r2',
          storeName: 'Walmart',
          totalAmount: 50,
          lineItems: [
            { id: '3', name: 'Discount', amount: -15 },
            { id: '4', name: 'Bread', amount: 8 },
          ],
        }),
      ],
      2026,
      5,
    );
    expect(s.biggestItem).toEqual({
      receiptId: 'r1',
      storeName: 'Costco',
      itemName: 'EKO MIRROR',
      amount: 69.99,
    });
  });

  it('sorts categories descending and picks topCategory', () => {
    const s = summarizeMonth(
      [
        baseReceipt({
          totalAmount: 100,
          lineItems: [
            { id: '1', name: 'Milk', amount: 30, category: 'Groceries' },
            { id: '2', name: 'Shoes', amount: 70, category: 'Clothing' },
          ],
        }),
      ],
      2026,
      5,
    );
    expect(s.categories.map((c) => c.category)).toEqual(['Clothing', 'Groceries']);
    expect(s.topCategory?.category).toBe('Clothing');
  });

  it('handles custom categoryTag-style categories alongside standard ones', () => {
    const s = summarizeMonth(
      [
        baseReceipt({
          totalAmount: 200,
          lineItems: [
            { id: '1', name: 'Shoes', amount: 150, category: 'Footwear' },
            { id: '2', name: 'Polish', amount: 50, category: 'Other' },
          ],
        }),
      ],
      2026,
      5,
    );
    expect(s.topCategory?.category).toBe('Footwear');
    expect(s.categories.find((c) => c.category === 'Footwear')?.total).toBe(150);
  });
});

describe('monthOverMonthDelta', () => {
  it('returns a positive delta when this month spent more than last', () => {
    const receipts = [
      baseReceipt({ id: '1', date: localIso(2026, 4, 10), totalAmount: 100 }),
      baseReceipt({ id: '2', date: localIso(2026, 5, 10), totalAmount: 150 }),
    ];
    const r = monthOverMonthDelta(receipts, 2026, 5);
    expect(r.thisMonth.total).toBe(150);
    expect(r.prevMonth.total).toBe(100);
    expect(r.delta).toBe(50);
    expect(r.deltaPct).toBeCloseTo(0.5, 5);
  });

  it('returns null pct when previous month had zero spend', () => {
    const receipts = [
      baseReceipt({ id: '1', date: localIso(2026, 5, 10), totalAmount: 100 }),
    ];
    const r = monthOverMonthDelta(receipts, 2026, 5);
    expect(r.prevMonth.total).toBe(0);
    expect(r.delta).toBe(100);
    expect(r.deltaPct).toBeNull();
  });

  it('handles January correctly (rolls back to December of previous year)', () => {
    const receipts = [
      baseReceipt({ id: '1', date: localIso(2025, 12, 20), totalAmount: 80 }),
      baseReceipt({ id: '2', date: localIso(2026, 1, 15), totalAmount: 120 }),
    ];
    const r = monthOverMonthDelta(receipts, 2026, 1);
    expect(r.prevMonth.year).toBe(2025);
    expect(r.prevMonth.month).toBe(12);
    expect(r.prevMonth.total).toBe(80);
    expect(r.thisMonth.total).toBe(120);
    expect(r.delta).toBe(40);
  });
});

describe('monthlyTrend', () => {
  it('returns N consecutive months including empty ones', () => {
    const receipts = [
      baseReceipt({ date: localIso(2026, 3, 5), totalAmount: 30 }),
      baseReceipt({ date: localIso(2026, 5, 12), totalAmount: 80 }),
    ];
    const trend = monthlyTrend(receipts, 2026, 5, 4);
    expect(trend).toHaveLength(4);
    expect(trend.map((b) => b.key)).toEqual([
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
    ]);
    expect(trend[0].total).toBe(0); // Feb empty
    expect(trend[1].total).toBe(30); // Mar
    expect(trend[2].total).toBe(0); // Apr empty
    expect(trend[3].total).toBe(80); // May
  });

  it('shortLabel uses the 3-letter month abbreviation', () => {
    const trend = monthlyTrend([], 2026, 5, 3);
    expect(trend.map((b) => b.shortLabel)).toEqual(['Mar', 'Apr', 'May']);
  });

  it('crosses year boundaries correctly', () => {
    const trend = monthlyTrend([], 2026, 2, 4);
    expect(trend.map((b) => b.key)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});

describe('topStores', () => {
  it('ranks by total spend, then visit count, then name', () => {
    const receipts = [
      baseReceipt({ storeName: 'Costco', totalAmount: 200 }),
      baseReceipt({ storeName: 'Costco', totalAmount: 100 }),
      baseReceipt({ storeName: 'Walmart', totalAmount: 250 }),
      baseReceipt({ storeName: 'Target', totalAmount: 100 }),
      baseReceipt({ storeName: 'Target', totalAmount: 50 }),
    ];
    const result = topStores(receipts, 3);
    expect(result[0]).toEqual({ storeName: 'Costco', total: 300, count: 2 });
    expect(result[1]).toEqual({ storeName: 'Walmart', total: 250, count: 1 });
    expect(result[2]).toEqual({ storeName: 'Target', total: 150, count: 2 });
  });

  it('limits the output to N rows', () => {
    const receipts = [
      baseReceipt({ storeName: 'A', totalAmount: 10 }),
      baseReceipt({ storeName: 'B', totalAmount: 20 }),
      baseReceipt({ storeName: 'C', totalAmount: 30 }),
      baseReceipt({ storeName: 'D', totalAmount: 40 }),
    ];
    expect(topStores(receipts, 2)).toHaveLength(2);
    expect(topStores(receipts, 10)).toHaveLength(4);
  });

  it('treats empty store names as "Unknown Store"', () => {
    const receipts = [
      baseReceipt({ storeName: '', totalAmount: 10 }),
      baseReceipt({ storeName: '   ', totalAmount: 5 }),
    ];
    const result = topStores(receipts);
    expect(result[0].storeName).toBe('Unknown Store');
    expect(result[0].total).toBe(15);
    expect(result[0].count).toBe(2);
  });
});

describe('filterReceiptsInRange', () => {
  const receipts = [
    baseReceipt({ id: 'a', date: localIso(2026, 4, 30), totalAmount: 10 }),
    baseReceipt({ id: 'b', date: localIso(2026, 5, 1), totalAmount: 20 }),
    baseReceipt({ id: 'c', date: localIso(2026, 5, 15), totalAmount: 30 }),
    baseReceipt({ id: 'd', date: localIso(2026, 5, 31), totalAmount: 40 }),
    baseReceipt({ id: 'e', date: localIso(2026, 6, 1), totalAmount: 50 }),
  ];

  it('includes both endpoints (inclusive)', () => {
    const r = filterReceiptsInRange(
      receipts,
      new Date(2026, 4, 1), // May 1
      new Date(2026, 4, 31), // May 31
    );
    expect(r.map((x) => x.id)).toEqual(['b', 'c', 'd']);
  });

  it('includes a date-only first-of-month receipt (not UTC-shifted out of the month)', () => {
    const r = filterReceiptsInRange(
      [baseReceipt({ id: 'day1', date: '2026-05-01', totalAmount: 5 })],
      new Date(2026, 4, 1),
      new Date(2026, 4, 31),
    );
    expect(r.map((x) => x.id)).toEqual(['day1']);
  });

  it('returns empty when no receipts fall in the range', () => {
    const r = filterReceiptsInRange(
      receipts,
      new Date(2027, 0, 1),
      new Date(2027, 0, 31),
    );
    expect(r).toEqual([]);
  });
});

describe('filterDatedInRange', () => {
  it('keeps date-only and local-ISO incomes on the same civil day', () => {
    const rows = [
      { id: 'civil', date: '2026-03-01', amountUsd: 100 },
      { id: 'local-iso', date: new Date(2026, 2, 1, 12, 0, 0).toISOString(), amountUsd: 50 },
      { id: 'feb', date: '2026-02-28', amountUsd: 9 },
      { id: 'apr', date: '2026-04-01', amountUsd: 9 },
      { id: 'junk', date: 'not-a-date', amountUsd: 9 },
    ];
    const inMarch = filterDatedInRange(rows, new Date(2026, 2, 1), new Date(2026, 2, 31));
    expect(inMarch.map((r) => r.id)).toEqual(['civil', 'local-iso']);
  });

  it('uses the local civil day of a timestamp, not the UTC YYYY-MM-DD prefix', () => {
    // 8pm Feb 28 local is often March 1 in UTC. A naive date.slice(0, 10) would
    // then count it as March and inflate Reports earned totals.
    const lateFeb = { id: 'late', date: new Date(2026, 1, 28, 20, 0, 0).toISOString() };
    expect(filterDatedInRange([lateFeb], new Date(2026, 2, 1), new Date(2026, 2, 31))).toEqual([]);
    expect(filterDatedInRange([lateFeb], new Date(2026, 1, 1), new Date(2026, 1, 28)).map((r) => r.id)).toEqual(['late']);
  });
});

describe('summarizeRange', () => {
  it('aggregates totals across multiple months within the range', () => {
    const receipts = [
      baseReceipt({ date: localIso(2026, 3, 15), totalAmount: 100 }),
      baseReceipt({ date: localIso(2026, 4, 20), totalAmount: 200 }),
      baseReceipt({ date: localIso(2026, 5, 10), totalAmount: 50 }),
      // Outside range — should be ignored
      baseReceipt({ date: localIso(2026, 2, 1), totalAmount: 999 }),
      baseReceipt({ date: localIso(2026, 6, 1), totalAmount: 999 }),
    ];
    const s = summarizeRange(
      receipts,
      new Date(2026, 2, 1),
      new Date(2026, 4, 31),
    );
    expect(s.total).toBe(350);
    expect(s.receiptCount).toBe(3);
    expect(s.avgPerReceipt).toBeCloseTo(116.67, 1);
  });

  it('picks biggest receipt and item across the range, not just one month', () => {
    const receipts = [
      baseReceipt({
        id: 'r1',
        date: localIso(2026, 3, 15),
        storeName: 'Costco',
        totalAmount: 200,
        lineItems: [{ id: '1', name: 'Mirror', amount: 150 }],
      }),
      baseReceipt({
        id: 'r2',
        date: localIso(2026, 5, 10),
        storeName: 'Walmart',
        totalAmount: 50,
        lineItems: [{ id: '2', name: 'Milk', amount: 5 }],
      }),
    ];
    const s = summarizeRange(
      receipts,
      new Date(2026, 2, 1),
      new Date(2026, 4, 31),
    );
    expect(s.biggestReceipt?.receiptId).toBe('r1');
    expect(s.biggestItem?.itemName).toBe('Mirror');
  });
});

describe('periodOverPeriodDelta', () => {
  it('compares a range to the same-length window immediately before it', () => {
    // May 2026 = 31 days. Prior period = April 2026 = 30 days, ending
    // April 30. The prior window therefore covers Apr 1 – Apr 30 (the
    // 31-day-back start lands on March 31).
    const receipts = [
      // current (May)
      baseReceipt({ date: localIso(2026, 5, 5), totalAmount: 100 }),
      baseReceipt({ date: localIso(2026, 5, 20), totalAmount: 50 }),
      // previous window (~April)
      baseReceipt({ date: localIso(2026, 4, 10), totalAmount: 80 }),
    ];
    const r = periodOverPeriodDelta(
      receipts,
      new Date(2026, 4, 1),
      new Date(2026, 4, 31),
    );
    expect(r.current.total).toBe(150);
    expect(r.previous.total).toBe(80);
    expect(r.delta).toBe(70);
    expect(r.deltaPct).toBeCloseTo(0.875, 3);
  });

  it('returns null pct when previous window had zero spend', () => {
    const receipts = [
      baseReceipt({ date: localIso(2026, 5, 10), totalAmount: 100 }),
    ];
    const r = periodOverPeriodDelta(
      receipts,
      new Date(2026, 4, 1),
      new Date(2026, 4, 31),
    );
    expect(r.previous.total).toBe(0);
    expect(r.delta).toBe(100);
    expect(r.deltaPct).toBeNull();
  });
});

describe('categoryTrends', () => {
  it('returns top-N categories as monthly time series across the window', () => {
    const receipts = [
      baseReceipt({
        date: localIso(2026, 3, 10),
        totalAmount: 100,
        lineItems: [
          { id: '1', name: 'Milk', amount: 60, category: 'Groceries' },
          { id: '2', name: 'Shoes', amount: 40, category: 'Clothing' },
        ],
      }),
      baseReceipt({
        date: localIso(2026, 4, 10),
        totalAmount: 50,
        lineItems: [
          { id: '3', name: 'Bread', amount: 50, category: 'Groceries' },
        ],
      }),
      baseReceipt({
        date: localIso(2026, 5, 10),
        totalAmount: 80,
        lineItems: [
          { id: '4', name: 'Eggs', amount: 80, category: 'Groceries' },
        ],
      }),
    ];
    const trends = categoryTrends(receipts, 2026, 5, 4, 4);
    const groceries = trends.find((t) => t.category === 'Groceries')!;
    expect(groceries.points.map((p) => p.total)).toEqual([0, 60, 50, 80]);
    expect(groceries.thisMonth).toBe(80);
    expect(groceries.prevMonth).toBe(50);
    expect(groceries.delta).toBe(30);
    expect(groceries.windowTotal).toBe(190);
    const clothing = trends.find((t) => t.category === 'Clothing');
    expect(clothing).toBeDefined();
    expect(clothing!.points.map((p) => p.total)).toEqual([0, 40, 0, 0]);
  });

  it('limits to topN by window total', () => {
    const receipts = [
      baseReceipt({
        date: localIso(2026, 5, 10),
        totalAmount: 200,
        lineItems: [
          { id: '1', name: 'A', amount: 100, category: 'Groceries' },
          { id: '2', name: 'B', amount: 50, category: 'Clothing' },
          { id: '3', name: 'C', amount: 30, category: 'Dining' },
          { id: '4', name: 'D', amount: 20, category: 'Gas' },
        ],
      }),
    ];
    const trends = categoryTrends(receipts, 2026, 5, 6, 2);
    expect(trends).toHaveLength(2);
    expect(trends[0].category).toBe('Groceries');
    expect(trends[1].category).toBe('Clothing');
  });
});

describe('findRecurring', () => {
  it('flags a store that appears in 3+ distinct months', () => {
    const receipts = [
      baseReceipt({ storeName: 'Shell', date: localIso(2026, 3, 5), totalAmount: 40 }),
      baseReceipt({ storeName: 'Shell', date: localIso(2026, 4, 8), totalAmount: 42 }),
      baseReceipt({ storeName: 'Shell', date: localIso(2026, 5, 12), totalAmount: 45 }),
      baseReceipt({ storeName: 'OneOff', date: localIso(2026, 4, 1), totalAmount: 10 }),
    ];
    const matches = findRecurring(receipts, 3);
    const shell = matches.find((m) => m.kind === 'store' && m.displayName === 'Shell');
    expect(shell).toBeDefined();
    expect(shell!.monthKeys).toEqual(['2026-03', '2026-04', '2026-05']);
    expect(shell!.occurrences).toBe(3);
    expect(shell!.total).toBe(127);
    expect(matches.find((m) => m.displayName === 'OneOff')).toBeUndefined();
  });

  it('flags an item that repeats across months at the same store', () => {
    const receipts = [
      baseReceipt({
        storeName: 'Loblaws',
        date: localIso(2026, 3, 5),
        totalAmount: 4,
        lineItems: [{ id: '1', name: 'Organic Milk 2%', amount: 4, category: 'Groceries' }],
      }),
      baseReceipt({
        storeName: 'Loblaws',
        date: localIso(2026, 4, 5),
        totalAmount: 4,
        lineItems: [{ id: '2', name: 'ORGANIC MILK 1%', amount: 4, category: 'Groceries' }],
      }),
      baseReceipt({
        storeName: 'Loblaws',
        date: localIso(2026, 5, 5),
        totalAmount: 4,
        lineItems: [{ id: '3', name: 'organic milk', amount: 4, category: 'Groceries' }],
      }),
    ];
    const matches = findRecurring(receipts, 3);
    const milk = matches.find((m) => m.kind === 'item' && /milk/i.test(m.displayName));
    expect(milk).toBeDefined();
    expect(milk!.monthKeys.length).toBe(3);
  });

  it('does NOT flag an item that recurs across DIFFERENT stores', () => {
    const receipts = [
      baseReceipt({
        storeName: 'StoreA',
        date: localIso(2026, 3, 5),
        totalAmount: 5,
        lineItems: [{ id: '1', name: 'Bread', amount: 5, category: 'Groceries' }],
      }),
      baseReceipt({
        storeName: 'StoreB',
        date: localIso(2026, 4, 5),
        totalAmount: 5,
        lineItems: [{ id: '2', name: 'Bread', amount: 5, category: 'Groceries' }],
      }),
      baseReceipt({
        storeName: 'StoreC',
        date: localIso(2026, 5, 5),
        totalAmount: 5,
        lineItems: [{ id: '3', name: 'Bread', amount: 5, category: 'Groceries' }],
      }),
    ];
    const matches = findRecurring(receipts, 3);
    expect(matches.filter((m) => m.kind === 'item')).toHaveLength(0);
  });

  it('ignores negative-amount (discount) line items', () => {
    const receipts = [
      baseReceipt({
        storeName: 'X',
        date: localIso(2026, 3, 5),
        totalAmount: 0,
        lineItems: [{ id: '1', name: 'Promo Discount', amount: -10, category: 'Other' }],
      }),
      baseReceipt({
        storeName: 'X',
        date: localIso(2026, 4, 5),
        totalAmount: 0,
        lineItems: [{ id: '2', name: 'Promo Discount', amount: -10, category: 'Other' }],
      }),
      baseReceipt({
        storeName: 'X',
        date: localIso(2026, 5, 5),
        totalAmount: 0,
        lineItems: [{ id: '3', name: 'Promo Discount', amount: -10, category: 'Other' }],
      }),
    ];
    const matches = findRecurring(receipts, 3);
    expect(matches.filter((m) => m.kind === 'item')).toHaveLength(0);
  });
});

describe('receiptsToCsv', () => {
  it('emits header + one row per line item', () => {
    const csv = receiptsToCsv([
      baseReceipt({
        date: '2026-05-10T00:00:00.000Z',
        storeName: 'Walmart',
        totalAmount: 18.95,
        subtotalAmount: 17.50,
        taxAmount: 1.45,
        category: 'Groceries',
        categoryTags: ['Groceries'],
        lineItems: [
          { id: '1', name: 'Milk', amount: 3.99, category: 'Groceries' },
          { id: '2', name: 'Bread', amount: 4.50, category: 'Groceries' },
        ],
      }),
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Date,Store,Currency,ReceiptTotal');
    expect(lines).toHaveLength(3); // header + 2 items
    expect(lines[1]).toContain('Walmart');
    expect(lines[1]).toContain('Milk');
    expect(lines[1]).toContain('3.99');
  });

  it('escapes commas, quotes, and newlines in fields', () => {
    const csv = receiptsToCsv([
      baseReceipt({
        date: '2026-05-10T00:00:00.000Z',
        storeName: 'Smith, Sons & Co.',
        totalAmount: 10,
        notes: 'Said "thanks"\nNext line',
        lineItems: [
          { id: '1', name: 'Item, with comma', amount: 10, category: 'Other' },
        ],
      }),
    ]);
    expect(csv).toContain('"Smith, Sons & Co."');
    expect(csv).toContain('"Item, with comma"');
    expect(csv).toContain('"Said ""thanks""');
  });

  it('emits a single row for receipts without line items', () => {
    const csv = receiptsToCsv([
      baseReceipt({
        date: '2026-05-10T00:00:00.000Z',
        storeName: 'Diner',
        totalAmount: 25,
        category: 'Dining',
        categoryTags: ['Dining'],
      }),
    ]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2); // header + 1 row
    expect(lines[1]).toContain('Diner');
    expect(lines[1]).toContain('Dining');
  });
});
