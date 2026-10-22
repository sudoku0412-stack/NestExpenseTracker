import { tr, getActiveLanguage } from './i18n';
import { categoryLabel } from './categoryLabel';
import { calendarDateKey } from './calendarDate';
import { intlLocale } from './dateLocale';
import { Income, Receipt } from '../types';
import { CurrencyCode, CURRENCY_SYMBOLS, convertFromUsd, currencyDecimals, currencyPrefix } from './currency';
import { computeCashflow } from './cashflowStats';

// expo-file-system is required lazily inside generateReceiptsPdf so
// Jest (running pure-JS template tests for the HTML output) doesn't
// load the native module at import time.

/**
 * PDF export for the Reports screen.
 *
 * expo-print uses the new Expo Modules API (requireNativeModule), so
 * the native side is NOT registered on react-native's NativeModules
 * global. Probing NativeModules.ExpoPrint always returned falsy, even
 * on APKs that had the module linked — that's why earlier builds
 * silently fell back to CSV.
 *
 * Instead we lazy-require the JS shim inside a try/catch. On a build
 * without the native side linked, importing 'expo-print' triggers a
 * `requireNativeModule('ExpoPrint')` deep inside that throws — the
 * catch sets the cached availability to null and the caller falls
 * back to CSV. On a build with the native side linked, the require
 * succeeds and we cache the loaded module.
 *
 * The check runs at most once per session (cached). Calling it has
 * the side effect of resolving the module, so the subsequent
 * generateReceiptsPdf() doesn't pay the require cost twice.
 */

type PrintModule = {
  printToFileAsync: (opts: {
    html: string;
    width?: number;
    height?: number;
    base64?: boolean;
  }) => Promise<{ uri: string }>;
};

let cachedMod: PrintModule | null | undefined;

function loadPrint(): PrintModule | null {
  if (cachedMod !== undefined) return cachedMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const candidate = require('expo-print') as Partial<PrintModule>;
    if (candidate && typeof candidate.printToFileAsync === 'function') {
      cachedMod = candidate as PrintModule;
    } else {
      cachedMod = null;
    }
  } catch {
    // Native module not linked in this APK — caller falls back to CSV.
    cachedMod = null;
  }
  return cachedMod;
}

export function isPdfExportAvailable(): boolean {
  return loadPrint() != null;
}

/**
 * Internal export used by the snapshot-style test that renders the
 * PDF HTML offline (so we can preview the layout in Chrome headless
 * without spinning up the native print pipeline). Not part of the
 * public API — consumers should call generateReceiptsPdf instead.
 */
export const buildHtmlForPreview = (args: {
  receipts: Receipt[];
  incomes?: Income[];
  startLabel: string;
  endLabel: string;
  currency?: CurrencyCode;
}): string => buildHtml(args);

// ---------- HTML template ----------

// Every amount fed to fmtMoney is USD-canonical (Receipt.totalAmount
// etc.) — this converts to the export's target currency once, at the
// point of formatting, so the PDF matches whatever the user sees in
// the app instead of always showing raw USD with a hardcoded "$".
function fmtMoney(n: number, currency: CurrencyCode): string {
  const converted = convertFromUsd(n, currency);
  const decimals = currencyDecimals(currency);
  return `${currencyPrefix(currency)}${converted.toFixed(decimals)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Build the printable HTML. Keep styles inline + simple so iOS
 * UIPrint and Android PrintManager render it consistently. The
 * layout is one summary card up top, then chronological receipt
 * cards underneath — each receipt block lists its line items.
 */
// Category color + icon map shared with the app's theme. Hard-coded
// here so the PDF generator stays a pure module — pulling from
// constants/theme.ts would couple it to RN's StyleSheet runtime
// for no good reason (we render strings, not styles).
const CATEGORY_VISUAL: Record<
  string,
  { color: string; tint: string; icon: string }
> = {
  Groceries:     { color: '#10B981', tint: '#D1FAE5', icon: '🛒' },
  Electronics:   { color: '#3B82F6', tint: '#DBEAFE', icon: '💻' },
  Dining:        { color: '#F59E0B', tint: '#FEF3C7', icon: '🍽️' },
  Pharmacy:      { color: '#EC4899', tint: '#FCE7F3', icon: '💊' },
  Gas:           { color: '#8B5CF6', tint: '#EDE9FE', icon: '⛽' },
  Clothing:      { color: '#F97316', tint: '#FFEDD5', icon: '👗' },
  Entertainment: { color: '#06B6D4', tint: '#CFFAFE', icon: '🎬' },
  Travel:        { color: '#84CC16', tint: '#ECFCCB', icon: '✈️' },
  Healthcare:    { color: '#EF4444', tint: '#FEE2E2', icon: '🏥' },
  Electricity:   { color: '#CA8A04', tint: '#FEF9C3', icon: '⚡' },
  Investments:   { color: '#1B6B4A', tint: '#D1FAE5', icon: '📊' },
  Recurring:     { color: '#6B5CA5', tint: '#EDE9FE', icon: '🔁' },
  Other:         { color: '#64748B', tint: '#E2E8F0', icon: '📦' },
};
const DEFAULT_VISUAL = { color: '#64748B', tint: '#E2E8F0', icon: '🏷️' };

function visualFor(category: string): { color: string; tint: string; icon: string } {
  return CATEGORY_VISUAL[category] ?? DEFAULT_VISUAL;
}

function buildHtml(args: {
  receipts: Receipt[];
  incomes?: Income[];
  startLabel: string;
  endLabel: string;
  currency?: CurrencyCode;
}): string {
  const { receipts, incomes = [], startLabel, endLabel, currency = 'USD' } = args;
  const cashflow = computeCashflow(incomes, receipts);
  const money = (n: number) => fmtMoney(n, currency);
  const sorted = [...receipts].sort((a, b) => a.date.localeCompare(b.date));

  const totalSpent = sorted.reduce((s, r) => s + (r.totalAmount || 0), 0);
  const totalReceipts = sorted.length;
  const avgPerReceipt = totalReceipts > 0 ? totalSpent / totalReceipts : 0;

  // Per-category aggregate, split evenly across each receipt's tags
  // (so a receipt tagged Groceries+Dining contributes half to each).
  const byCategory = new Map<string, number>();
  for (const r of sorted) {
    const tags = (r.categoryTags ?? [r.category]).filter(Boolean);
    const share = (r.totalAmount || 0) / Math.max(tags.length, 1);
    for (const t of tags) {
      byCategory.set(t, (byCategory.get(t) ?? 0) + share);
    }
  }
  const categoryEntries = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const topCategoryAmount = categoryEntries[0]?.[1] ?? 0;
  const categoryRows = categoryEntries
    .map(([cat, amt]) => {
      const v = visualFor(cat);
      const pct = totalSpent > 0 ? (amt / totalSpent) * 100 : 0;
      // Bar width relative to the top category, so the visual scales
      // intuitively when one or two categories dominate.
      const barPct = topCategoryAmount > 0 ? (amt / topCategoryAmount) * 100 : 0;
      return `
        <div class="cat-row">
          <div class="cat-head">
            <span class="cat-name">
              <span class="cat-icon" style="background:${v.tint};color:${v.color};">${v.icon}</span>
              ${escapeHtml(categoryLabel(cat))}
            </span>
            <span class="cat-meta">
              <span class="cat-pct">${pct.toFixed(1)}%</span>
              <span class="cat-amt">${money(amt)}</span>
            </span>
          </div>
          <div class="cat-bar-bg">
            <div class="cat-bar-fg" style="width:${barPct.toFixed(2)}%; background:${v.color};"></div>
          </div>
        </div>`;
    })
    .join('');

  const receiptCards = sorted
    .map((r) => {
      const dateOnly = calendarDateKey(r.date) ?? r.date.slice(0, 10);
      const tags = (r.categoryTags ?? [r.category]).filter(Boolean);
      const tagPills = tags
        .map((t) => {
          const v = visualFor(t);
          return `<span class="tag-pill" style="background:${v.tint};color:${v.color};">${v.icon} ${escapeHtml(categoryLabel(t))}</span>`;
        })
        .join('');
      const lineItemRows = (r.lineItems ?? [])
        .map((it) => {
          const v = visualFor(it.category ?? 'Other');
          return `
            <tr>
              <td class="item-name">${escapeHtml(it.name)}</td>
              <td class="item-cat">
                <span class="item-cat-dot" style="background:${v.color};"></span>
                ${escapeHtml(categoryLabel((it.category ?? '') as string))}
              </td>
              <td class="num">${money(it.amount)}</td>
            </tr>`;
        })
        .join('');
      const itemsTable = lineItemRows
        ? `<table class="items">
             <thead><tr><th>${tr('pdfItem')}</th><th>${tr('pdfCategory')}</th><th class="num">${tr('pdfAmount')}</th></tr></thead>
             <tbody>${lineItemRows}</tbody>
           </table>`
        : `<p class="muted">${tr('pdfNoLineItems')}</p>`;
      const subtotal =
        r.subtotalAmount != null
          ? `<span class="tot-sub">${tr('pdfSubtotal')} <strong>${money(r.subtotalAmount)}</strong></span>`
          : '';
      const tax =
        r.taxAmount != null
          ? `<span class="tot-sub">${tr('pdfTax')} <strong>${money(r.taxAmount)}</strong></span>`
          : '';
      const notes = r.notes
        ? `<p class="notes"><strong>${tr('pdfNotes')}</strong> ${escapeHtml(r.notes)}</p>`
        : '';
      const headlineColor = visualFor(tags[0] ?? 'Other').color;
      return `
        <section class="receipt">
          <header class="receipt-head" style="border-left-color:${headlineColor};">
            <div class="receipt-headline">
              <h3>${escapeHtml(r.storeName)}</h3>
              <span class="receipt-date">${dateOnly}</span>
            </div>
            <div class="receipt-grand">${money(r.totalAmount)}</div>
          </header>
          ${tagPills ? `<div class="tag-row">${tagPills}</div>` : ''}
          ${itemsTable}
          <div class="totals">
            ${subtotal}${tax}
          </div>
          ${notes}
        </section>`;
    })
    .join('');

  // Brand palette + print-friendly typography. Avoid loading webfonts
  // (the WKWebView print pipeline won't fetch over the network), and
  // ride the system stack so emoji renders natively.
  const styles = `
    @page { margin: 0; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue",
        Arial, "Apple Color Emoji", "Segoe UI Emoji", sans-serif;
      color: #0F172A;
      margin: 0;
      background: #FFFFFF;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── Hero banner ──────────────────────────────────────────────── */
    .hero {
      background: linear-gradient(135deg, #047857 0%, #10B981 55%, #34D399 100%);
      color: #FFFFFF;
      padding: 36px 32px 28px;
    }
    .hero-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      opacity: 0.92;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .hero-brand .dot {
      display: inline-block; width: 8px; height: 8px;
      background: #FFFFFF; border-radius: 50%;
      box-shadow: 0 0 0 3px rgba(255,255,255,0.25);
    }
    .hero h1 {
      font-size: 30px; font-weight: 800;
      margin: 14px 0 4px; letter-spacing: -0.5px;
    }
    .hero .hero-range {
      font-size: 13px; opacity: 0.92; margin: 0 0 18px;
    }
    .hero .stats {
      display: flex; gap: 12px; flex-wrap: wrap;
    }
    .hero .stat {
      flex: 1 1 30%;
      background: rgba(255,255,255,0.16);
      border: 1px solid rgba(255,255,255,0.24);
      border-radius: 10px;
      padding: 12px 14px;
      backdrop-filter: blur(6px);
    }
    .hero .stat-label {
      font-size: 10px; font-weight: 700; letter-spacing: 0.12em;
      text-transform: uppercase; opacity: 0.86;
    }
    .hero .stat-value {
      display: block; font-size: 22px; font-weight: 800;
      margin-top: 4px; letter-spacing: -0.3px;
      font-variant-numeric: tabular-nums;
    }

    /* ── Section frame ────────────────────────────────────────────── */
    .frame { padding: 26px 32px 32px; }
    h2 {
      font-size: 13px; font-weight: 700; letter-spacing: 0.10em;
      text-transform: uppercase; color: #0F172A; margin: 18px 0 12px;
    }
    h2:first-child { margin-top: 0; }

    /* ── Category bars ────────────────────────────────────────────── */
    .cat-row { margin: 12px 0; page-break-inside: avoid; }
    .cat-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 6px;
    }
    .cat-name {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 13px; font-weight: 600; color: #0F172A;
    }
    .cat-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 22px; height: 22px; border-radius: 6px;
      font-size: 12px;
    }
    .cat-meta { display: inline-flex; align-items: baseline; gap: 10px; }
    .cat-pct {
      font-size: 11px; color: #64748B; font-variant-numeric: tabular-nums;
    }
    .cat-amt {
      font-size: 13px; font-weight: 700; color: #0F172A;
      font-variant-numeric: tabular-nums;
    }
    .cat-bar-bg {
      height: 8px; border-radius: 999px; background: #F1F5F9; overflow: hidden;
    }
    .cat-bar-fg { height: 100%; border-radius: 999px; }

    /* ── Receipt cards ────────────────────────────────────────────── */
    .receipt {
      page-break-inside: avoid;
      margin: 16px 0;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      padding: 14px 16px 12px;
      background: #FFFFFF;
    }
    .receipt-head {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px;
      padding-left: 10px;
      border-left: 4px solid #10B981;
      margin: -2px 0 8px -16px;
      padding: 2px 0 2px 12px;
    }
    .receipt-headline h3 {
      font-size: 15px; font-weight: 700; color: #0F172A; margin: 0;
    }
    .receipt-date {
      font-size: 11px; color: #64748B; font-variant-numeric: tabular-nums;
    }
    .receipt-grand {
      font-size: 18px; font-weight: 800; color: #047857;
      font-variant-numeric: tabular-nums;
    }
    .tag-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
    .tag-pill {
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 10px; font-weight: 600;
      padding: 3px 8px; border-radius: 999px;
    }

    /* ── Line item table ──────────────────────────────────────────── */
    table.items {
      width: 100%; border-collapse: collapse; font-size: 11px; margin: 4px 0 8px;
    }
    table.items th {
      text-align: left; font-weight: 700; padding: 6px 8px;
      border-bottom: 1px solid #E2E8F0;
      color: #64748B;
      font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em;
    }
    table.items td { padding: 7px 8px; border-bottom: 1px solid #F1F5F9; }
    table.items tr:nth-child(even) td { background: #F8FAFC; }
    table.items tr:last-child td { border-bottom: none; }
    table.items td.num, table.items th.num {
      text-align: right; font-variant-numeric: tabular-nums; font-weight: 600;
    }
    .item-name { color: #0F172A; font-weight: 500; }
    .item-cat {
      color: #475569; font-size: 11px;
      white-space: nowrap;
    }
    .item-cat-dot {
      display: inline-block; width: 8px; height: 8px;
      border-radius: 50%; margin-right: 6px; vertical-align: middle;
    }

    /* ── Per-receipt subtotal / tax footer ────────────────────────── */
    .totals {
      display: flex; justify-content: flex-end; gap: 14px;
      font-size: 11px; color: #475569;
      padding-top: 4px;
    }
    .totals strong {
      color: #0F172A; margin-left: 4px;
      font-variant-numeric: tabular-nums;
    }
    .totals .tot-sub strong { color: #0F172A; }
    .notes {
      font-size: 11px; color: #475569; margin: 8px 0 0;
      padding: 8px 10px; background: #F8FAFC; border-radius: 6px;
      border-left: 3px solid #E2E8F0;
    }
    p.muted {
      color: #94A3B8; font-style: italic; font-size: 11px; margin: 4px 0;
    }

    /* ── Footer ───────────────────────────────────────────────────── */
    .footer {
      margin: 28px 32px 18px;
      padding-top: 14px;
      border-top: 1px solid #E2E8F0;
      font-size: 10px; color: #94A3B8;
      display: flex; justify-content: space-between;
    }
  `;

  const generatedAt = new Date();

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" />
<title>${tr('pdfTitle')}</title>
<style>${styles}</style>
</head><body>

<section class="hero">
  <div class="hero-brand"><span class="dot"></span> ${tr('pdfBrand')}</div>
  <h1>${escapeHtml(startLabel)} — ${escapeHtml(endLabel)}</h1>
  <p class="hero-range">${escapeHtml(
    tr('pdfGenerated', {
      when: generatedAt.toLocaleString(intlLocale(getActiveLanguage()), {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    }),
  )}</p>
  <div class="stats">
    <div class="stat">
      <div class="stat-label">${tr('pdfReceipts')}</div>
      <span class="stat-value">${totalReceipts}</span>
    </div>
    <div class="stat">
      <div class="stat-label">${tr('pdfTotalSpent')}</div>
      <span class="stat-value">${money(totalSpent)}</span>
    </div>
    <div class="stat">
      <div class="stat-label">${tr('pdfAvgPerReceipt')}</div>
      <span class="stat-value">${money(avgPerReceipt)}</span>
    </div>
    ${
      incomes.length > 0
        ? `<div class="stat">
      <div class="stat-label">${tr('pdfEarned')}</div>
      <span class="stat-value">${money(cashflow.totalEarned)}</span>
    </div>
    <div class="stat">
      <div class="stat-label">${tr('pdfNet')}</div>
      <span class="stat-value">${money(cashflow.net)}</span>
    </div>`
        : ''
    }
  </div>
</section>

<section class="frame">
  ${
    incomes.length > 0
      ? `<h2>${tr('pdfCashflow')}</h2>
         <p class="muted">${tr('pdfEarned')} ${money(cashflow.totalEarned)} · ${tr('pdfSpent')} ${money(cashflow.totalSpent)} · ${tr('pdfNet')} ${money(cashflow.net)}${
           cashflow.investedUsd > 0
             ? ` · ${tr('pdfInvestments')} ${money(cashflow.investedUsd)}${
                 cashflow.savingsRate != null
                   ? ` (${tr('pdfSavedPct', { pct: (cashflow.savingsRate * 100).toFixed(0) })})`
                   : ''
               }`
             : ''
         }</p>`
      : ''
  }
  ${
    categoryRows
      ? `<h2>${tr('pdfSpendingByCategory')}</h2>
         ${categoryRows}`
      : ''
  }

  <h2>${tr('pdfReceipts')}</h2>
  ${receiptCards || `<p class="muted">${tr('pdfNoReceipts')}</p>`}
</section>

<footer class="footer">
  <span>NestExpenseTracker · ${tr('pdfFooterReceipts', { count: totalReceipts })}</span>
  <span>${tr('pdfTotalSuffix', { amount: money(totalSpent) })}</span>
</footer>

</body></html>`;
}

/**
 * Generate a PDF for the given receipts. Returns the file URI, or
 * `null` if expo-print isn't linked in the running build (caller
 * should fall back to CSV).
 *
 * If `filename` is provided, the raw printToFileAsync output (which
 * gets an auto-generated name like `Print_<timestamp>.pdf`) is moved
 * into the app's documentDirectory under that name, so the share
 * sheet's preview label, the saved-to-Files name, and the email
 * attachment all show the friendly name instead of "Print_XXXX.pdf".
 */
export async function generateReceiptsPdf(args: {
  receipts: Receipt[];
  incomes?: Income[];
  startLabel: string;
  endLabel: string;
  filename?: string;
  currency?: CurrencyCode;
}): Promise<string | null> {
  const Print = loadPrint();
  if (!Print) return null;
  const html = buildHtml(args);
  try {
    const { uri } = await Print.printToFileAsync({
      html,
      // US Letter @ 72 DPI; native renderer handles scaling for both
      // iOS UIPrint and Android PrintManager.
      width: 612,
      height: 792,
      base64: false,
    });
    if (!args.filename) return uri;
    // Rename into documentDirectory so the share-sheet sees the
    // friendly filename. moveAsync is atomic on both iOS and Android,
    // and the cache-directory original is removed in the same call.
    // Lazy-require to avoid pulling expo-file-system's ESM into Jest.
    // eslint-disable-next-line @typescript-eslint/no-require-imports, global-require
    const FileSystem = require('expo-file-system') as typeof import('expo-file-system');
    const dest = `${FileSystem.documentDirectory}${args.filename}`;
    try {
      // If a previous export with the same name is still on disk,
      // delete it first — moveAsync errors on an existing destination.
      await FileSystem.deleteAsync(dest, { idempotent: true });
      await FileSystem.moveAsync({ from: uri, to: dest });
      return dest;
    } catch {
      // The rename is a nice-to-have; if it fails we still have the
      // valid auto-named PDF and return that.
      return uri;
    }
  } catch {
    return null;
  }
}
