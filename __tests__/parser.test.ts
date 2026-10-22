import { parseReceiptText, mergeDiscountLines, parseYmdLocal } from '../lib/parser';
import { LineItem } from '../types';

const li = (over: Partial<LineItem>): LineItem => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  name: over.name ?? '',
  amount: over.amount ?? 0,
  category: over.category,
});

describe('parseReceiptText - store name extraction', () => {
  it('uses the first non-noise line as the store name', () => {
    const text = ['Whole Foods Market', '123 Main St', '555-1234', 'Total $42.10'].join('\n');
    expect(parseReceiptText(text).storeName).toBe('Whole Foods Market');
  });

  it('skips phone numbers, addresses, and dates when picking store name', () => {
    const text = [
      '555-123-4567',
      '12/05/2026',
      '42 Oak Avenue',
      'Trader Joes',
      'Total $10.00',
    ].join('\n');
    expect(parseReceiptText(text).storeName).toBe('Trader Joes');
  });

  it('skips greeting/header lines like "Thank you" and "Receipt"', () => {
    const text = ['Thank you for shopping', 'Receipt #4521', 'Best Buy', 'Total $99.99'].join('\n');
    expect(parseReceiptText(text).storeName).toBe('Best Buy');
  });

  it('skips URL lines', () => {
    const text = ['www.example.com', 'CVS Pharmacy', 'Total $15.00'].join('\n');
    expect(parseReceiptText(text).storeName).toBe('CVS Pharmacy');
  });

  it('falls back to "Unknown Store" when no usable line exists', () => {
    expect(parseReceiptText('').storeName).toBe('Unknown Store');
    expect(parseReceiptText('555-1234\n12/05/2026').storeName).toBe('Unknown Store');
  });

  it('skips BOGO promo banners (with OCR mangling) and falls back to known chain', () => {
    // Real-world: user photographs only the bottom half of a Skechers
    // receipt. The actual SKECHERS header is cropped out but the
    // diagonal watermark still bleeds "SKECHERS" into the OCR text.
    // The first content line is a mangled BOGO banner. The parser
    // should NOT use the banner as the store name.
    const text = [
      '***B0GU D0% 0ff Footwear***',
      '197627199313 REVOLTED SD - MAVIS- $46.99T',
      'Subtotal $46.99',
      'SKECHERS',
    ].join('\n');
    expect(parseReceiptText(text).storeName).toMatch(/^skechers$/i);
  });

  it('skips "50% off" and "Sale" promo lines', () => {
    const text = [
      '50% Off Everything',
      'Sale',
      'Old Navy',
      'Total $25.00',
    ].join('\n');
    expect(parseReceiptText(text).storeName).toBe('Old Navy');
  });
});

describe('parseReceiptText - date extraction', () => {
  it('extracts ISO YYYY-MM-DD format', () => {
    const result = parseReceiptText('Some Store\nDate: 2025-03-14\nTotal $5.00');
    expect(result.date.startsWith('2025-03-14')).toBe(true);
  });

  it('extracts MM/DD/YYYY format', () => {
    const result = parseReceiptText('Some Store\n03/14/2025\nTotal $5.00');
    expect(result.date.startsWith('2025-03-14')).toBe(true);
  });

  it('extracts MM-DD-YYYY format', () => {
    const result = parseReceiptText('Some Store\n03-14-2025\nTotal $5.00');
    expect(result.date.startsWith('2025-03-14')).toBe(true);
  });

  it('extracts "Month DD, YYYY" format', () => {
    const result = parseReceiptText('Some Store\nMay 8, 2025\nTotal $5.00');
    expect(result.date.startsWith('2025-05-08')).toBe(true);
  });

  it('extracts "DD Month YYYY" format', () => {
    const result = parseReceiptText('Some Store\n8 May 2025\nTotal $5.00');
    expect(result.date.startsWith('2025-05-08')).toBe(true);
  });

  it('extracts MM/DD/YY (2-digit year) format', () => {
    const result = parseReceiptText('Some Store\n03/14/25\nTotal $5.00');
    expect(result.date.startsWith('2025-03-14')).toBe(true);
  });

  it('falls back to today when no date found', () => {
    const before = Date.now();
    const result = parseReceiptText('Some Store\nTotal $5.00');
    const parsed = new Date(result.date).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before - 1000);
    expect(parsed).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('rejects future dates and falls back to today', () => {
    const result = parseReceiptText('Some Store\n2099-12-31\nTotal $5.00');
    expect(result.date.startsWith('2099')).toBe(false);
  });

  it('rejects dates before year 2000', () => {
    const result = parseReceiptText('Some Store\n1995-06-15\nTotal $5.00');
    expect(result.date.startsWith('1995')).toBe(false);
  });

  it('extracts MM/DD/YYYY with trailing time (e.g. "08/31/2025 05:48:02 PM")', () => {
    // Skechers footer format. Previously could accidentally match the
    // address number or other digits; now we look at the whole text.
    const result = parseReceiptText(
      'Store: 1431 Reg: 22 Tran: 17328\nDate: 08/31/2025 05:48:02 PM Assoc: 416855\nTotal $5.00',
    );
    expect(result.date.startsWith('2025-08-31')).toBe(true);
  });

  it('extracts YYYY/MM/DD slash format (Costco footer)', () => {
    const result = parseReceiptText(
      'COSTCO\nAUTH #: 3292E 2026/05/09 19:01:09\nTotal $5.00',
    );
    expect(result.date.startsWith('2026/05/09'.replace(/\//g, '-'))).toBe(true);
  });

  it('picks the most recent plausible date when multiple candidates exist', () => {
    // Receipts often have a "valid until" or address-line date in
    // addition to the actual transaction date. The transaction date
    // is almost always the most recent one.
    const result = parseReceiptText(
      'Some Store\nValid Through: 2024-12-31\nDate: 2026-05-09\nTotal $5.00',
    );
    expect(result.date.startsWith('2026-05-09')).toBe(true);
  });

  it('handles European DD/MM/YYYY when day > 12 disambiguates', () => {
    // "25/03/2025" — 25 can't be a month, so we know day=25 month=3.
    const result = parseReceiptText('Some Store\n25/03/2025\nTotal $5.00');
    expect(result.date.startsWith('2025-03-25')).toBe(true);
  });

  it('preserves wall-clock date when round-tripped through local-time format', () => {
    // Regression: extractDate used to build the Date via the ISO
    // string constructor ("YYYY-MM-DD"), which parses as UTC midnight.
    // Users in negative-offset timezones (EDT, PDT, etc.) then saw
    // the previous day after formatting back in local time. Now the
    // (y, m, d) ctor is used so local time is preserved.
    const result = parseReceiptText('Some Store\n08/31/2025\nTotal $5.00');
    const d = new Date(result.date);
    // getDate/getMonth/getFullYear are all LOCAL — which is exactly
    // what the UI uses via date-fns `format`. The wall-clock date
    // must match the receipt regardless of the test machine's TZ.
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(7); // August (0-indexed)
    expect(d.getDate()).toBe(31);
  });
});

describe('parseReceiptText - total amount extraction', () => {
  it('picks up "Grand Total" with highest priority', () => {
    const text = 'Some Store\nSubtotal $5.00\nGrand Total $42.99\nThanks';
    expect(parseReceiptText(text).totalAmount).toBe(42.99);
  });

  it('picks up "Total Due"', () => {
    expect(parseReceiptText('Store\nTotal Due: $19.50').totalAmount).toBe(19.5);
  });

  it('picks up "Amount Due"', () => {
    expect(parseReceiptText('Store\nAmount Due: 33.00').totalAmount).toBe(33.0);
  });

  it('picks up plain "Total" keyword', () => {
    expect(parseReceiptText('Store\nTotal $7.25').totalAmount).toBe(7.25);
  });

  it('handles total on a line below the keyword', () => {
    const text = 'Store\nItem 1 $5.00\nTotal\n$12.34\nThanks';
    expect(parseReceiptText(text).totalAmount).toBe(12.34);
  });

  it('parses comma thousands separators', () => {
    expect(parseReceiptText('Store\nTotal $1,234.56').totalAmount).toBe(1234.56);
  });

  it('falls back to largest $ amount when no keyword present', () => {
    const text = 'Store\n$3.00\n$15.00\n$8.99';
    expect(parseReceiptText(text).totalAmount).toBe(15.0);
  });

  it('falls back to largest bare decimal when no $ signs', () => {
    const text = 'Store\nItem A 3.00\nItem B 15.00\nItem C 8.99';
    expect(parseReceiptText(text).totalAmount).toBe(15.0);
  });

  it('returns 0 when no amount can be detected', () => {
    expect(parseReceiptText('Store\nNo prices here').totalAmount).toBe(0);
  });

  it('rejects implausibly large amounts (>100,000)', () => {
    const text = 'Store\nTotal $999999.00\n$5.00';
    expect(parseReceiptText(text).totalAmount).toBe(5.0);
  });
});

describe('parseReceiptText - category detection', () => {
  it('classifies grocery store names', () => {
    expect(parseReceiptText('Whole Foods Market\nTotal $20').category).toBe('Groceries');
    expect(parseReceiptText('Trader Joes\nTotal $20').category).toBe('Groceries');
  });

  it('classifies electronics stores', () => {
    expect(parseReceiptText('Best Buy\nLaptop $999.99').category).toBe('Electronics');
  });

  it('classifies pharmacy stores', () => {
    expect(parseReceiptText('CVS Pharmacy\nTotal $15').category).toBe('Pharmacy');
  });

  it('classifies gas stations', () => {
    expect(parseReceiptText('Shell Gas Station\nGallons 12.5\nTotal $45').category).toBe('Gas');
  });

  it('classifies dining/restaurants', () => {
    expect(parseReceiptText('Pizza Hut\nTotal $25').category).toBe('Dining');
  });

  it('returns "Other" when no keywords match', () => {
    expect(parseReceiptText('Generic Inc\nWidget $5').category).toBe('Other');
  });
});

describe('parseReceiptText - line items extraction', () => {
  it('extracts items with prices at the end of the line', () => {
    const text = ['Store', 'Apples 3.00', 'Bread 4.50', 'Total $7.50'].join('\n');
    const items = parseReceiptText(text).lineItems;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: 'Apples', amount: 3.0 });
    expect(items[1]).toMatchObject({ name: 'Bread', amount: 4.5 });
  });

  it('skips lines with total/tax/discount keywords', () => {
    const text = [
      'Store',
      'Apples 3.00',
      'Subtotal 3.00',
      'Tax 0.30',
      'Total 3.30',
      'Discount -0.50',
    ].join('\n');
    const items = parseReceiptText(text).lineItems;
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Apples');
  });

  it('caps line items at 50 to prevent runaway parsing on huge receipts', () => {
    const lines = ['Store'];
    for (let i = 0; i < 80; i++) lines.push(`Item${i} 1.00`);
    expect(parseReceiptText(lines.join('\n')).lineItems).toHaveLength(50);
  });

  it('returns empty array when no recognizable items present', () => {
    expect(parseReceiptText('Store\nThanks for visiting').lineItems).toEqual([]);
  });

  it('assigns a unique id to each item', () => {
    const text = ['Store', 'Apples 3.00', 'Bread 4.50'].join('\n');
    const items = parseReceiptText(text).lineItems;
    expect(items[0].id).not.toBe(items[1].id);
    expect(items[0].id).toBeTruthy();
  });
});

describe('parseReceiptText - categoryTags derivation', () => {
  it('derives unique tags from line item categories', () => {
    const text = [
      'Walmart',
      'YOGA MAT 21.98',     // Healthcare
      'TB CHC CROIS 5.98',  // Groceries
      'SHRIMP RING 4.97',   // Groceries (duplicate of Groceries)
      'Total 32.93',
    ].join('\n');
    const tags = parseReceiptText(text).categoryTags ?? [];
    expect(tags).toContain('Healthcare');
    expect(tags).toContain('Groceries');
    expect(tags.length).toBe(2);  // unique
  });

  it('falls back to receipt-level category when no items have tags', () => {
    const text = ['Walmart', 'Total 1.00'].join('\n');
    const tags = parseReceiptText(text).categoryTags ?? [];
    expect(tags.length).toBeGreaterThan(0);
  });
});

describe('parseReceiptText - integration', () => {
  it('parses a realistic grocery receipt end-to-end', () => {
    const text = [
      'Whole Foods Market',
      '123 Market St',
      '555-1234',
      'Date: 2025-04-12',
      '',
      'Organic Apples         4.99',
      'Sourdough Bread        6.50',
      'Almond Milk            3.99',
      '',
      'Subtotal              15.48',
      'Tax                    1.24',
      'Total                $16.72',
      '',
      'Thank you!',
    ].join('\n');

    const r = parseReceiptText(text);
    expect(r.storeName).toBe('Whole Foods Market');
    expect(r.totalAmount).toBe(16.72);
    expect(r.category).toBe('Groceries');
    expect(r.date.startsWith('2025-04-12')).toBe(true);
    expect(r.lineItems.length).toBeGreaterThanOrEqual(3);
  });

  it('handles empty input without throwing', () => {
    const r = parseReceiptText('');
    expect(r.storeName).toBe('Unknown Store');
    expect(r.totalAmount).toBe(0);
    expect(r.lineItems).toEqual([]);
    expect(r.category).toBe('Other');
  });

  it('always returns a valid ISO date string', () => {
    const r = parseReceiptText('garbage input with no date');
    expect(() => new Date(r.date).toISOString()).not.toThrow();
    expect(new Date(r.date).getTime()).not.toBeNaN();
  });
});

describe('parseReceiptText - Walmart-style receipt with UPCs and HST', () => {
  // Real-world Walmart receipt: each item line ends with a 12-digit UPC code,
  // the price, and a single-letter tax-status flag (J / D). HST is a Canadian
  // sales tax that should be extracted separately from the grand total.
  const walmartText = [
    'Walmart',
    'STORE 3001',
    '270 KINGSTON RD E. R.R # 1',
    'AJAX, ON  L1Z 1G1',
    '905-426-6160',
    'ST# 03001 OP# 009053 TE# 53 TR# 01327',
    '10LB NEOPREN 191730242300       14.97 J',
    '10LB NEOPREN 191730242300       14.97 J',
    '5LB RUBBER 191730242350         9.98 J',
    '5LB RUBBER 191730242350         9.98 J',
    'AW FRESHMTIC 062338856640       12.47 J',
    'TB CHC CROIS 770981561170       5.98 D',
    'YOGA MAT 840737122350           21.98 J',
    'PR CF DRY TL 841421125960       9.97 J',
    'CO OPP BB S7 697678203208       5.00 J',
    'MRKIPCHOC 756781003060          3.77 D',
    'SHRIMP RING 627735264120        4.97 J',
    'SUBTOTAL                        114.04',
    'HST 13.0000 %                   13.56',
    'TOTAL                           127.60',
    'MCARD TEND                      127.60',
    'CHANGE DUE                       0.00',
  ].join('\n');

  it('detects Walmart as the store', () => {
    const r = parseReceiptText(walmartText);
    expect(r.storeName.toLowerCase()).toContain('walmart');
  });

  it('strips trailing OCR garbage from the store name', () => {
    const noisy = `Walmart >%\n${walmartText.split('\n').slice(1).join('\n')}`;
    expect(parseReceiptText(noisy).storeName).toBe('Walmart');
  });

  // Real photo from a phone scan included a Mac keyboard background, so
  // OCR returned "option", "return", "shift" before the receipt text.
  // The store-name extractor must prefer the chain name over keyboard keys.
  it('prefers a known chain over keyboard / UI noise lines', () => {
    const ocr = [
      'option',
      'return',
      'shift',
      'Walmart',
      'STORE 3001',
      '270 KINGSTON RD',
    ].join('\n');
    expect(parseReceiptText(ocr).storeName).toBe('Walmart');
  });

  it('falls back to a non-noise heuristic when no known chain is found', () => {
    const ocr = [
      'option',
      'return',
      'Acme Corner Store',
      '123 Some St',
    ].join('\n');
    expect(parseReceiptText(ocr).storeName).toBe('Acme Corner Store');
  });

  it('extracts the grand total ($127.60), not the subtotal or tax line', () => {
    expect(parseReceiptText(walmartText).totalAmount).toBe(127.6);
  });

  it('extracts HST as taxAmount ($13.56), separate from total', () => {
    expect(parseReceiptText(walmartText).taxAmount).toBe(13.56);
  });

  it('extracts the subtotal ($114.04)', () => {
    expect(parseReceiptText(walmartText).subtotalAmount).toBe(114.04);
  });

  it('extracts all 11 line items', () => {
    expect(parseReceiptText(walmartText).lineItems).toHaveLength(11);
  });

  it('strips UPC codes from item names', () => {
    const items = parseReceiptText(walmartText).lineItems;
    for (const item of items) {
      expect(item.name).not.toMatch(/\d{8,14}/);
    }
  });

  it('strips trailing status letter from item names', () => {
    const items = parseReceiptText(walmartText).lineItems;
    for (const item of items) {
      expect(item.name).not.toMatch(/\s+[A-Z]$/);
    }
  });

  it('every line item has a category assigned', () => {
    const items = parseReceiptText(walmartText).lineItems;
    for (const item of items) {
      expect(item.category).toBeDefined();
    }
  });

  it('item subtotals across categories sum to the receipt subtotal', () => {
    const items = parseReceiptText(walmartText).lineItems;
    const sum = items.reduce((s, i) => s + i.amount, 0);
    expect(sum).toBeCloseTo(114.04, 2);
  });

  it('food items (croissant, chocolate, shrimp) categorize as Groceries', () => {
    const items = parseReceiptText(walmartText).lineItems;
    const crois = items.find((i) => /crois/i.test(i.name));
    const chocolate = items.find((i) => /choc/i.test(i.name));
    const shrimp = items.find((i) => /shrimp/i.test(i.name));
    expect(crois?.category).toBe('Groceries');
    expect(chocolate?.category).toBe('Groceries');
    expect(shrimp?.category).toBe('Groceries');
  });

  it('fitness items (neoprene weights, yoga mat, rubber) categorize as Healthcare', () => {
    const items = parseReceiptText(walmartText).lineItems;
    const yoga = items.find((i) => /yoga/i.test(i.name));
    const neopren = items.find((i) => /neopren/i.test(i.name));
    expect(yoga?.category).toBe('Healthcare');
    expect(neopren?.category).toBe('Healthcare');
  });

  it('does not pick up the SUBTOTAL/HST/TOTAL/TEND lines as items', () => {
    const items = parseReceiptText(walmartText).lineItems;
    for (const item of items) {
      expect(item.name).not.toMatch(/total|hst|tend|change/i);
    }
  });
});

describe('parseReceiptText - two-column OCR (names and prices on separate lines)', () => {
  // Real OCR output from a phone-camera scan of the same Walmart receipt.
  // ML Kit returned the left column (item names + UPCs) as one block, then
  // the right column (prices) as a second block. The parser must pair
  // name[i] with price[i].
  const twoColumnOcr = [
    'Walmart',
    'STORE 3001',
    '270 KINGSTON RD ERR# 1',
    'AJAX, ON',
    'L1Z 1G1',
    '905-426-6160',
    'ST# 03001 OP# 009053 TE# 53',
    'TR# 01327',
    '10LB NEOPREN 191730242300',
    '10LB NEOPREN 191730242300',
    '5LB RUBBER 191730242350',
    '5LB RUBBER 191730242350',
    'AW FRESHMTIC 062338856640',
    'TB CHC CROIS 770981561170',
    'YOGA MAT 840737122350',
    'PR CF DRY TL 841421125960',
    'CO OPP BB S7 697678203208',
    'MRKIPCHOC 756781003060',
    'SHRIMP RING 627735264120',
    '$14.97 J',
    '$14.97 J',
    '$9.98 J',
    '$9.98 J',
    '$12.47 J',
    '$5.98 D',
    '$21.98 J',
    '$9.97 J',
    '$5.00 J',
    '$3.77 D',
    '$4.97 J',
    'SUBTOTAL $114.04',
    'HST 13.0000% $13.56',
    'TOTAL $127.60',
  ].join('\n');

  it('extracts all 11 line items by pairing names with later price lines', () => {
    const r = parseReceiptText(twoColumnOcr);
    expect(r.lineItems.length).toBe(11);
  });

  it('still extracts the grand total ($127.60) from the totals block', () => {
    expect(parseReceiptText(twoColumnOcr).totalAmount).toBe(127.6);
  });

  it('still extracts subtotal and tax from the totals block', () => {
    const r = parseReceiptText(twoColumnOcr);
    expect(r.subtotalAmount).toBe(114.04);
    expect(r.taxAmount).toBe(13.56);
  });

  it('pairs item names with the right prices in order', () => {
    const items = parseReceiptText(twoColumnOcr).lineItems;
    expect(items[0].name).toMatch(/neopren/i);
    expect(items[0].amount).toBe(14.97);
    expect(items[6]?.name).toMatch(/yoga/i);
    expect(items[6]?.amount).toBe(21.98);
    expect(items[10]?.name).toMatch(/shrimp/i);
    expect(items[10]?.amount).toBe(4.97);
  });

  it('strips UPC codes from paired names', () => {
    const items = parseReceiptText(twoColumnOcr).lineItems;
    for (const item of items) {
      expect(item.name).not.toMatch(/\d{8,14}/);
    }
  });

  it('item subtotals sum to ~ $114.04', () => {
    const sum = parseReceiptText(twoColumnOcr).lineItems.reduce(
      (s, i) => s + i.amount,
      0,
    );
    expect(sum).toBeCloseTo(114.04, 2);
  });

  it('drops Canadian postal codes like "L1Z 1G1" from the items list', () => {
    const ocr = [
      'Walmart',
      '270 KINGSTON RD',
      'AJAX, ON',
      'L1Z 1G1',
      '10LB NEOPREN 191730242300',
      '5LB RUBBER 191730242350',
      'YOGA MAT 840737122350',
      '$14.97',
      '$9.98',
      '$21.98',
    ].join('\n');
    const items = parseReceiptText(ocr).lineItems;
    expect(items.length).toBe(3);
    for (const item of items) {
      expect(item.name).not.toMatch(/L1Z|1G1/);
    }
  });

  it('drops bank/EMV reference rows like "RRN 613051 344514"', () => {
    const ocr = [
      'Walmart',
      '10LB NEOPREN 191730242300',
      'YOGA MAT 840737122350',
      '$14.97',
      '$21.98',
      'RRN 613051 344514',
      'AID A0000000041010',
      'TC 6C57B8FA60B28743',
    ].join('\n');
    const items = parseReceiptText(ocr).lineItems;
    expect(items.length).toBe(2);
    for (const item of items) {
      expect(item.name).not.toMatch(/RRN|AID|TC\b/);
    }
  });

  // AID and TC are EMV tags whose values are alphanumeric hex (start
  // with letters, e.g. "A0000000041010" or "6C57B8FA60B28743"). The
  // simple "label + 3+ digits" pattern misses them; we have a separate
  // hex-aware skip rule.
  it('drops AID with hex value starting with a letter ("AID A0000000041010")', () => {
    const ocr = [
      'Walmart',
      'YOGA MAT 840737122350',
      '$21.98',
      'AID A0000000041010',
    ].join('\n');
    const items = parseReceiptText(ocr).lineItems;
    expect(items.length).toBe(1);
    expect(items[0].name).toMatch(/yoga/i);
  });

  it('drops "No Signature Required" payment-block line', () => {
    const ocr = [
      'Walmart',
      'YOGA MAT 840737122350',
      '$21.98',
      'No Signature Required',
    ].join('\n');
    const items = parseReceiptText(ocr).lineItems;
    expect(items.length).toBe(1);
    for (const item of items) {
      expect(item.name).not.toMatch(/signature/i);
    }
  });

  it('treats "5.00 d" (lowercase tax-status letter) as a price, not a name', () => {
    // Real OCR sometimes returns the trailing tax-status flag in
    // lowercase ("d" instead of "D"). Earlier the regex required
    // uppercase, so the line was buffered as a name and the matching
    // item got paired with the WRONG price.
    const ocr = [
      'Walmart',
      'YOGA MAT 840737122350',
      'CO OPP BB S7 697678203208',
      '$21.98 J',
      '5.00 d',
    ].join('\n');
    const items = parseReceiptText(ocr).lineItems;
    expect(items.length).toBe(2);
    expect(items[0].amount).toBe(21.98);
    expect(items[1].amount).toBe(5.0);
    for (const item of items) {
      expect(item.name).not.toMatch(/^[\d.]+\s*[a-z]?$/i);
    }
  });

  it('drops subtotal if same-line regex captures a value greater than total', () => {
    // Defensive: if SUBTOTAL gets matched against the grand-total amount
    // (because OCR mixed up columns), don't trust it. Better to leave
    // subtotal undefined than to display "Subtotal $127.60 / Total $127.60".
    const ocr = [
      'Walmart',
      '10LB NEOPREN 191730242300 14.97',
      'SUBTOTAL 127.60',
      'TOTAL 127.60',
    ].join('\n');
    const r = parseReceiptText(ocr);
    expect(r.totalAmount).toBe(127.6);
    expect(r.subtotalAmount).toBeUndefined();
  });

  it('drops Costco-specific markers (Bottom of basket, BOB count, Member, AMOUNT)', () => {
    const ocr = [
      'Costco',
      'ZV Member 111965941177',
      '1420528 VEGGIES PK 4 14.99',
      '*****Bottom of basket*****',
      '*****BOB Count*****',
      '5220007 BENCH SANDAL 49.99',
      'AMOUNT: $210.17',
      'Items Sold: 7',
      'XXXXXXXXXXXX0933',
    ].join('\n');
    const items = parseReceiptText(ocr).lineItems;
    // Should pick up only the 2 real items, not the markers/header noise.
    expect(items.length).toBe(2);
    for (const item of items) {
      expect(item.name).not.toMatch(
        /amount|member|basket|bob|items?\s+sold|x{4,}/i,
      );
    }
  });

  it("doesn't pull Costco footer text (CUSTOMER COPY, IMPORTANT, AID hex, barcode stamp) as items", () => {
    const ocr = [
      'Costco',
      '1571579 12 HANGING 19.99',
      '1295582 ROSE 19.99',
      '*****Bottom of basket*****',
      '*****BOB Count*****',
      '313963 KS ORG EGGS 12.49',
      'SUBTOTAL 52.47',
      'TAX 6.82',
      'TOTAL 59.29',
      'XXXXXXXXXXXX0933',
      'ACCT: MASTERCARD',
      'REFERENCE',
      '#: 0010013870 C',
      'AUTH #: 3292E',
      'A0000000041010',
      '0000008000 E800',
      'P (H)HST 13%',
      '01 APPROVED - THANK YOU 027',
      'IMPORTANT - retain this copy',
      'for your records',
      'CUSTOMER COPY',
      '20267/057/0E 19 01 09 1591',
    ].join('\n');
    const items = parseReceiptText(ocr).lineItems;
    expect(items.length).toBe(3);
    for (const item of items) {
      expect(item.name).not.toMatch(
        /reference|important|customer|retain|records|approved|asket|chdhst|^[A-F0-9]+$/i,
      );
    }
  });

  it('does not over-match: "First Aid Kit" survives the AID skip', () => {
    // 'First Aid Kit' contains 'aid' but Kit isn't 8+ hex chars, so the
    // EMV-style rule shouldn't fire. The line itself isn't picked as an
    // item here because it has no price, but it shouldn't be treated as
    // skipped if it had been part of a real line item like "First Aid Kit 12.99".
    const ocr = ['Walmart', 'First Aid Kit 12.99'].join('\n');
    const items = parseReceiptText(ocr).lineItems;
    expect(items.length).toBe(1);
    expect(items[0].name).toMatch(/first aid kit/i);
  });

  // skipRe must catch transaction-id rows even when OCR drops the '#'.
  it('drops transaction-id rows like "ST 03001 OP 009053 TE 53" with no #', () => {
    const ocr = [
      'Walmart',
      'STORE 3001',
      '270 KINGSTON RD',
      'AJAX, ON',
      'ST 03001 OP 009053 TE 53',  // OCR dropped the # symbols
      'TR 01327',
      '10LB NEOPREN 191730242300',
      '5LB RUBBER 191730242350',
      'YOGA MAT 840737122350',
      '$14.97',
      '$9.98',
      '$21.98',
    ].join('\n');
    const items = parseReceiptText(ocr).lineItems;
    expect(items.length).toBe(3);
    for (const item of items) {
      expect(item.name).not.toMatch(/ST 03001|OP 009053|TE 53|TR 01327/);
    }
  });

  // tax regex must not splice "13.00" out of a rate string like "13.0000".
  it('extracts HST $13.56 even when the rate is written "13.0000 %"', () => {
    const ocr = [
      'Walmart',
      'TR 01327',
      '10LB NEOPREN 191730242300',
      'SUBTOTAL',
      'HST 13.0000 %',
      'TOTAL',
      '$14.97',
      '$14.97',
      '$1.95',
      '$16.92',
    ].join('\n');
    expect(parseReceiptText(ocr).taxAmount).toBe(1.95);
  });

  // the totals amounts (subtotal, tax, total) must NOT be paired with items.
  it('does not pair the subtotal/tax/total amounts as item prices', () => {
    const ocr = [
      'Walmart',
      'TR 01327',
      '10LB NEOPREN 191730242300',
      '5LB RUBBER 191730242350',
      'YOGA MAT 840737122350',
      'SUBTOTAL',
      'HST 13.0000%',
      'TOTAL',
      '$14.97',
      '$9.98',
      '$21.98',
      '$46.93',  // subtotal
      '$6.10',   // tax
      '$53.03',  // total
    ].join('\n');
    const items = parseReceiptText(ocr).lineItems;
    expect(items.length).toBe(3);
    const amounts = items.map((i) => i.amount);
    expect(amounts).not.toContain(46.93);
    expect(amounts).not.toContain(6.10);
    expect(amounts).not.toContain(53.03);
    expect(amounts).toEqual([14.97, 9.98, 21.98]);
  });

  // The actual phone OCR puts the totals labels (SUBTOTAL / HST / TOTAL)
  // at the END of the names block, BEFORE the prices block. Earlier
  // versions of the parser broke out at "HST" and discarded every item
  // price. This case asserts the pairer keeps going.
  it('survives totals labels appearing inside the names block', () => {
    const ocr = [
      'Walmart',
      'STORE 3001',
      '270 KINGSTON RD',
      'AJAX, ON',
      '10LB NEOPREN 191730242300',
      '5LB RUBBER 191730242350',
      'YOGA MAT 840737122350',
      'SUBTOTAL',
      'HST 13.0000%',
      'TOTAL',
      '$14.97',
      '$9.98',
      '$21.98',
      '$46.93',
      '$6.10',
      '$53.03',
    ].join('\n');
    const r = parseReceiptText(ocr);
    expect(r.lineItems.length).toBe(3);
    expect(r.lineItems[0].name).toMatch(/neopren/i);
    expect(r.lineItems[0].amount).toBe(14.97);
    expect(r.lineItems[2].name).toMatch(/yoga/i);
    expect(r.lineItems[2].amount).toBe(21.98);
  });
});

describe('mergeDiscountLines', () => {
  it('returns the input unchanged when there are no negative amounts', () => {
    const items = [
      li({ name: 'Milk', amount: 5 }),
      li({ name: 'Bread', amount: 4 }),
    ];
    const merged = mergeDiscountLines(items);
    expect(merged).toHaveLength(2);
    expect(merged.map((i) => i.amount)).toEqual([5, 4]);
  });

  it('merges a TPD/{SKU} markdown into the item whose name contains that SKU', () => {
    // Costco pattern: discount line references the SKU of the item above.
    const items = [
      li({ name: 'VEGGIES PK 4', amount: 14.99 }),
      li({ name: '1993379 EKO MIRROR', amount: 69.99 }),
      li({ name: 'TPD/1993379', amount: -15.0 }),
      li({ name: '12" HANGING', amount: 19.99 }),
    ];
    const merged = mergeDiscountLines(items);
    expect(merged).toHaveLength(3);
    const mirror = merged.find((i) => /mirror/i.test(i.name))!;
    expect(mirror.amount).toBe(54.99);
    expect(merged.some((i) => i.amount < 0)).toBe(false);
  });

  it('falls back to the immediately preceding positive line when no SKU match', () => {
    const items = [
      li({ name: 'T-SHIRT', amount: 25 }),
      li({ name: 'MEMBER DISCOUNT', amount: -5 }),
      li({ name: 'PANTS', amount: 40 }),
    ];
    const merged = mergeDiscountLines(items);
    expect(merged).toHaveLength(2);
    expect(merged.find((i) => /shirt/i.test(i.name))!.amount).toBe(20);
  });

  it('clamps the merged amount to 0 when the discount exceeds the item price', () => {
    const items = [
      li({ name: 'Trial item', amount: 10 }),
      li({ name: 'Free promo', amount: -15 }),
    ];
    const merged = mergeDiscountLines(items);
    expect(merged).toHaveLength(1);
    expect(merged[0].amount).toBe(0);
  });

  it('leaves a discount alone when there is no preceding positive item', () => {
    const items = [
      li({ name: 'Coupon', amount: -5 }),
      li({ name: 'Soup', amount: 3 }),
    ];
    const merged = mergeDiscountLines(items);
    // No target → discount stays as its own line.
    expect(merged).toHaveLength(2);
    expect(merged[0].amount).toBe(-5);
  });

  it('handles multiple discounts each merging into their own target', () => {
    const items = [
      li({ name: '1111111 Item A', amount: 50 }),
      li({ name: '2222222 Item B', amount: 30 }),
      li({ name: 'TPD/1111111', amount: -10 }),
      li({ name: 'TPD/2222222', amount: -5 }),
    ];
    const merged = mergeDiscountLines(items);
    expect(merged).toHaveLength(2);
    const a = merged.find((i) => /item a/i.test(i.name))!;
    const b = merged.find((i) => /item b/i.test(i.name))!;
    expect(a.amount).toBe(40);
    expect(b.amount).toBe(25);
  });
});

describe('parseReceiptText - Costco TPD markdown lines', () => {
  it('folds the TPD markdown into the EKO MIRROR price', () => {
    const ocr = [
      'COSTCO',
      'WHOLESALE',
      'N Oshawa #1591',
      '1420528 VEGGIES PK 4 14.99 H',
      '1993379 EKO MIRROR 69.99 H',
      '2067431 TPD/1993379 15.00- H',
      '1571579 12" HANGING 19.99 H',
      'SUBTOTAL 119.96',
      'TAX 15.60',
      'TOTAL 135.56',
    ].join('\n');
    const r = parseReceiptText(ocr);
    const mirror = r.lineItems.find((i) => /mirror/i.test(i.name));
    expect(mirror).toBeDefined();
    expect(mirror!.amount).toBeCloseTo(54.99, 2);
    expect(r.lineItems.some((i) => i.amount < 0)).toBe(false);
  });
});

describe('parseReceiptText - Skechers multi-line items with BOGO discount', () => {
  // Each item spans 3-4 OCR rows: name+price, Style:, Size:Color:, and
  // optionally BOGO/New Price/discount lines. The parser must extract
  // exactly 4 items and apply the $52.50 BOGO discount to the
  // ON-THE-GO FLEX item.
  const ocr = [
    'SKECHERS',
    'OSHAWA SOUTH SMARTCENTERS',
    '560 LAVAL DRIVE',
    'UNIT #C0001',
    'OSHAWA ONTARIO, ON L1J 0B5',
    'SALE',
    '***BOGO 50% Off Footwear***',
    '197627156231 UNO - SUITED ON AIR $110.00T',
    'Style: 183004BLK',
    'Size: 8 Color: BLACK',
    'BOGO 50% Off Footwear $0.00',
    'New Price: $110.00',
    '197976255623 ON-THE-GO FLEX - CO $104.99T',
    'Style: 138215NVW',
    'Size: 8 Color: NVY/WHT ($52.50)',
    'BOGO 50% Off Footwear',
    'New Price: $52.49',
    '******',
    '197627199313 REVOLTED SD - MAVIS- $46.99T',
    'Style: 205166BLK',
    'Size: 7 Color: BLACK',
    '192283775864 SHOE CARE GIFT SET - $18.00T',
    'Style: SK0027AST',
    'Size: ONE SIZE ONLY Color: ASSORTED',
    'Subtotal $227.48',
    'Harmonized Sales Tax 13 % $29.57',
    'Total $257.05',
    'You Saved $52.50',
    'MasterCard $257.05',
  ].join('\n');

  it('extracts the store name as Skechers', () => {
    const r = parseReceiptText(ocr);
    expect(r.storeName).toMatch(/skechers/i);
  });

  it('does NOT emit Style:, Size:, BOGO, or New Price lines as items', () => {
    const r = parseReceiptText(ocr);
    for (const item of r.lineItems) {
      expect(item.name).not.toMatch(/^style\b/i);
      expect(item.name).not.toMatch(/^size\b/i);
      expect(item.name).not.toMatch(/^new\s+price/i);
      expect(item.name).not.toMatch(/^bogo/i);
      expect(item.name).not.toMatch(/^you\s+saved/i);
    }
  });

  it('treats ($52.50) parenthesized amount as a discount and merges into the previous item', () => {
    const r = parseReceiptText(ocr);
    // After discount merging, the ON-THE-GO FLEX line should be $52.49.
    const flex = r.lineItems.find((i) => /on.the.go\s+flex|flex/i.test(i.name));
    expect(flex).toBeDefined();
    expect(flex!.amount).toBeCloseTo(52.49, 1);
    // No standalone negative lines should leak through.
    expect(r.lineItems.some((i) => i.amount < 0)).toBe(false);
  });

  it('captures the $227.48 subtotal and $29.57 HST', () => {
    const r = parseReceiptText(ocr);
    expect(r.subtotalAmount).toBeCloseTo(227.48, 2);
    expect(r.taxAmount).toBeCloseTo(29.57, 2);
    expect(r.totalAmount).toBeCloseTo(257.05, 2);
  });

  it('extracts the transaction date 2025-08-31 from the footer', () => {
    const ocrWithDate = `${ocr}\nDate: 08/31/2025 05:48:02 PM Assoc: 416855`;
    const r = parseReceiptText(ocrWithDate);
    expect(r.date.startsWith('2025-08-31')).toBe(true);
  });
});

describe('parseReceiptText - Panchvati Supermarket grocery receipt', () => {
  // Real-world grocery receipt with three things the parser used to
  // mishandle:
  //   1. Multi-buy deal qualifier lines ("3 For $4.00", "2 For $1.00")
  //      printed beneath their item — used to be captured as ghost
  //      items named "3 For" / "2 For".
  //   2. Quantity rate breakdown ("2 @ $3.99") on its own line.
  //   3. A "-$2.98" discount column entry — used to be silently dropped
  //      because the regex didn't recognise minus-before-$, and even
  //      after capture the inline branch filtered out negative amounts
  //      from the price queue. Both broke 1:1 pairing in two-column OCR
  //      and shifted every subsequent item's price by one slot.
  const ocrColumns = [
    'PANCHVATI SUPERMARKET',
    '18 HARWOOD AVENUE SOUTH',
    'AJAX, ON L1S 7L8',
    'Bingo Tedhe Meche Masala',
    '80g',
    '3 For $4',
    'Pvs Calcutta Paan 250g',
    '2 @ $3.99',
    'Pvs Mukhwas 250 G',
    'Rajnigandha Silver Pearls',
    'Pvs Coriander Seeds 200g',
    'Pvs Cardamom Green 100g',
    'Pvs Cinnamon Round 100g',
    'Pvs Cumin Seeds 200g',
    'Kur Masala Munch 100g',
    '3 For $4.00',
    'Uncle Chips Spicy Treat 60g',
    '2 For $1.00',
    'Fresh Roti Jumbo 10pcs',
    'SUB-TOTAL',
    'HST 5%',
    'HST 13%',
    'TOTAL',
    // Price column (ML Kit two-column split).
    '$1.49 P',
    '$7.98',
    '-$2.98',
    '$3.99 P',
    '$3.49',
    '$9.49',
    '$2.79',
    '$3.99',
    '$1.49 P',
    '$1.49 P',
    '$6.99 F',
    '$40.21',
    '$0.35',
    '$1.10',
    '$42.22',
  ].join('\n');

  it('does NOT emit "3 For" or "2 For" as ghost line items', () => {
    const r = parseReceiptText(ocrColumns);
    expect(
      r.lineItems.some((it) => /^\s*\d+\s+(?:for|@|x)\s*$/i.test(it.name)),
    ).toBe(false);
    // Also: no item should claim the $4 deal price or the $1 deal price
    // as its line amount (both come from the qualifier lines).
    expect(r.lineItems.find((it) => /bingo/i.test(it.name))?.amount).not.toBe(4);
    expect(
      r.lineItems.find((it) => /uncle\s+chips/i.test(it.name))?.amount,
    ).not.toBe(1);
  });

  it('keeps post-discount items aligned with their correct prices', () => {
    const r = parseReceiptText(ocrColumns);
    // Rajnigandha sits one row after the Mukhwas discount in the price
    // column. Before the fix it inherited Coriander's $3.49 (off-by-one
    // shift caused by the dropped -$2.98). It should be back to $3.99.
    const rajnigandha = r.lineItems.find((it) => /rajnigandha/i.test(it.name));
    expect(rajnigandha?.amount).toBe(3.99);
    const coriander = r.lineItems.find((it) => /coriander/i.test(it.name));
    expect(coriander?.amount).toBe(3.49);
    const freshRoti = r.lineItems.find((it) => /fresh\s+roti/i.test(it.name));
    expect(freshRoti?.amount).toBe(6.99);
  });

  it('folds the -$2.98 Mukhwas discount into the Calcutta Paan line above', () => {
    const r = parseReceiptText(ocrColumns);
    const calcutta = r.lineItems.find((it) => /calcutta/i.test(it.name));
    expect(calcutta?.amount).toBeCloseTo(5.0, 2); // 7.98 - 2.98
    expect(r.lineItems.some((it) => it.amount < 0)).toBe(false);
  });
});

describe('parseReceiptText - negative price formats', () => {
  // Regression: the price regex only captured leading minus when the
  // line had NO $ sign ("-2.98"). For "-$2.98" the minus dropped and
  // the magnitude was returned positive, so discounts were not folded.
  it('captures "-$N.NN" (minus BEFORE the $) as a negative amount and merges it', () => {
    const text = [
      'Test Store',
      '20000001 WIDGET ALPHA $10.00',
      '20000002 LOYALTY MARKDOWN -$3.00',
      'Subtotal $7.00',
      'Total $7.00',
    ].join('\n');
    const r = parseReceiptText(text);
    // The -$3.00 markdown should fold into the widget (10 → 7). Before
    // the fix, the regex didn't recognise leading-minus-before-$ and
    // captured the line as +$3.00, so the markdown stayed positive and
    // the widget stayed at $10.
    const widget = r.lineItems.find((it) => /widget/i.test(it.name));
    expect(widget?.amount).toBeCloseTo(7.0, 2);
    expect(r.lineItems.some((it) => it.amount < 0)).toBe(false);
    expect(r.lineItems.some((it) => it.amount === 3.0)).toBe(false);
  });

  it('does NOT capture a word-trailing dash as a price sign (SKU dashes)', () => {
    // Two SKU-style item rows: "MAVIS-" and "GIFT SET -" both end with
    // a dash that's part of the style code. The price ($46.99 / $18.00)
    // should be positive — not flipped to negative by our minus-before-$
    // alternation greedily eating the trailing-name dash.
    const text = [
      'Test Store',
      '197627199313 REVOLTED SD - MAVIS- $46.99T',
      '192283775864 SHOE CARE GIFT SET - $18.00T',
      'Subtotal $64.99',
      'Total $64.99',
    ].join('\n');
    const r = parseReceiptText(text);
    const mavis = r.lineItems.find((it) => /mavis/i.test(it.name));
    const gift = r.lineItems.find((it) => /gift\s+set/i.test(it.name));
    expect(mavis?.amount).toBe(46.99);
    expect(gift?.amount).toBe(18);
  });
});

describe('parseYmdLocal', () => {
  it('keeps a date-only string on that civil day (not UTC midnight)', () => {
    const d = parseYmdLocal('2025-08-31');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2025);
    expect(d!.getMonth()).toBe(7);
    expect(d!.getDate()).toBe(31);
  });

  it('uses the Y-M-D prefix of an ISO timestamp, ignoring the clock', () => {
    const d = parseYmdLocal('2025-08-31T04:00:00.000Z');
    expect(d!.getFullYear()).toBe(2025);
    expect(d!.getMonth()).toBe(7);
    expect(d!.getDate()).toBe(31);
  });

  it('returns null for empty, slash-style, or garbage strings', () => {
    expect(parseYmdLocal('')).toBeNull();
    expect(parseYmdLocal('08/31/2025')).toBeNull();
    expect(parseYmdLocal('not-a-date')).toBeNull();
  });

  it('accepts a leap day', () => {
    const d = parseYmdLocal('2024-02-29');
    expect(d!.getMonth()).toBe(1);
    expect(d!.getDate()).toBe(29);
  });
});
