jest.mock('expo-print', () => ({ printToFileAsync: jest.fn() }));

import { buildHtmlForPreview, isPdfExportAvailable } from '../lib/pdfExport';
import { Receipt } from '../types';

const receipt = (overrides: Partial<Receipt>): Receipt => ({
  id: 'r1',
  storeName: 'Store',
  date: '2026-05-11',
  totalAmount: 10,
  category: 'Other',
  createdAt: '2026-05-11T00:00:00.000Z',
  updatedAt: '2026-05-11T00:00:00.000Z',
  ...overrides,
});

describe('isPdfExportAvailable', () => {
  it('true when expo-print is linked and exposes printToFileAsync', () => {
    expect(isPdfExportAvailable()).toBe(true);
  });
});

describe('buildHtmlForPreview', () => {
  it('escapes HTML special characters in the store name (XSS-style)', () => {
    const html = buildHtmlForPreview({
      receipts: [receipt({ storeName: '<script>alert(1)</script>' })],
      startLabel: 'A',
      endLabel: 'B',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes an ampersand in the store name', () => {
    const html = buildHtmlForPreview({
      receipts: [receipt({ storeName: 'Ben & Jerry\'s' })],
      startLabel: 'A',
      endLabel: 'B',
    });
    expect(html).toContain('Ben &amp; Jerry&#39;s');
  });

  it('escapes HTML special characters in notes', () => {
    const html = buildHtmlForPreview({
      receipts: [receipt({ notes: '<b>bold</b> & "quoted"' })],
      startLabel: 'A',
      endLabel: 'B',
    });
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).toContain('&quot;quoted&quot;');
  });

  it('includes each receipt store name and line items', () => {
    const html = buildHtmlForPreview({
      receipts: [
        receipt({
          storeName: 'Costco',
          lineItems: [{ id: 'a', name: 'Paper Towels', amount: 12.99, category: 'Groceries' }],
        }),
      ],
      startLabel: 'A',
      endLabel: 'B',
    });
    expect(html).toContain('Costco');
    expect(html).toContain('Paper Towels');
  });

  it('formats amounts as USD with $ and 2 decimals by default', () => {
    const html = buildHtmlForPreview({
      receipts: [receipt({ totalAmount: 42.5, storeName: 'USD Store' })],
      startLabel: 'A',
      endLabel: 'B',
    });
    expect(html).toContain('$42.50');
  });

  it('converts amounts to INR and formats with 0 decimals and the ₹ symbol', () => {
    const html = buildHtmlForPreview({
      receipts: [receipt({ totalAmount: 10, storeName: 'INR Store' })],
      startLabel: 'A',
      endLabel: 'B',
      currency: 'INR',
    });
    // 10 USD * 83.3 = 833
    expect(html).toContain('₹833');
    // No decimal point anywhere near an INR-formatted amount for this receipt.
    expect(html).not.toMatch(/₹833\.\d/);
  });

  it('converts line item amounts to the target currency too', () => {
    const html = buildHtmlForPreview({
      receipts: [
        receipt({
          totalAmount: 10,
          storeName: 'INR Store',
          lineItems: [{ id: 'a', name: 'Item', amount: 10, category: 'Other' }],
        }),
      ],
      startLabel: 'A',
      endLabel: 'B',
      currency: 'INR',
    });
    expect(html).toContain('₹833');
  });

  it('prints the local civil day for an evening ISO timestamp, not the UTC prefix', () => {
    const iso = new Date(2026, 4, 11, 20, 0, 0).toISOString();
    const html = buildHtmlForPreview({
      receipts: [receipt({ date: iso, storeName: 'Night Cafe' })],
      startLabel: 'A',
      endLabel: 'B',
    });
    expect(html).toContain('2026-05-11');
    const utcPrefix = iso.slice(0, 10);
    if (utcPrefix !== '2026-05-11') {
      expect(html).not.toContain(`>${utcPrefix}<`);
    }
  });

  it('handles an empty receipts array gracefully', () => {
    const html = buildHtmlForPreview({ receipts: [], startLabel: 'A', endLabel: 'B' });
    expect(html).toContain('No receipts in this range.');
  });

  it('adds a cashflow section when incomes are provided', () => {
    const html = buildHtmlForPreview({
      receipts: [receipt({ totalAmount: 100, category: 'Investments' })],
      incomes: [
        {
          id: 'i1',
          sourceName: 'Payroll',
          date: '2026-05-01',
          amountUsd: 1000,
          category: 'Salary',
          earnedBy: 'u1',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        },
      ],
      startLabel: 'A',
      endLabel: 'B',
    });
    expect(html).toContain('Cashflow');
    expect(html).toContain('Earned');
    expect(html).toContain('Investments');
  });
});
