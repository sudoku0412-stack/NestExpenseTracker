import * as SQLite from 'expo-sqlite';
import { calendarMonthSql, calendarMonthSqlParams } from './calendarDate';
import {
  Receipt,
  LineItem,
  Settlement,
  Income,
  IncomeCategory,
  SavingsGoal,
  InvestmentAccount,
  InvestmentKind,
  InvestmentSnapshot,
} from '../types';
import {
  syncReceiptDeletionToCloud,
  syncReceiptToCloud,
  syncSettlementToCloud,
  syncIncomeToCloud,
  syncIncomeDeletionToCloud,
  syncSavingsGoalToCloud,
  syncSavingsGoalDeletionToCloud,
  syncInvestmentAccountToCloud,
  syncInvestmentAccountDeletionToCloud,
  syncInvestmentSnapshotToCloud,
  uploadReceiptPhoto,
} from './cloudSync';

const db = SQLite.openDatabaseSync('receipts.db');

// ─── per-user scoping ──────────────────────────────────────────────────────
//
// Receipts, line items, and correction history are scoped to the currently
// authenticated user. We hold the uid as a module-level value that the
// AuthContext sets whenever Firebase fires onAuthStateChanged. Database
// functions that mutate or read user data require it to be non-null and
// stamp every INSERT / filter every SELECT with it.
//
// Why a module global instead of passing uid through every call site:
// the alternative is to thread uid into the 30+ database read/write paths
// (and into every callback in every screen). The module-global pattern
// keeps existing call sites unchanged — only the wiring at the AuthContext
// boundary moves. It's safe in single-threaded RN JS where there's exactly
// one current user at a time.

let currentUserId: string | null = null;
// Phase 2: cloud sync writes need a partition key. Stamped by
// AuthContext after ensureHouseholdForUser resolves. Stays null in
// local-only mode (older APK without Firestore, or before the
// console-side setup is done) — shadow writes silently skip when
// there's no household.
let currentHouseholdId: string | null = null;

export function setCurrentHouseholdId(hid: string | null): void {
  currentHouseholdId = hid;
}

export function getCurrentHouseholdId(): string | null {
  return currentHouseholdId;
}

/**
 * Set or clear the currently authenticated user. Called by AuthContext
 * on every auth state change. Passing `null` (e.g. on sign-out) puts
 * the database layer into a defensive mode where read/write ops throw
 * rather than silently expose another user's data.
 *
 * When called with a non-null uid AFTER a schema upgrade, this also
 * stamps any rows that pre-dated the user_id column with the current
 * uid. The stamp is idempotent — it only touches rows where user_id
 * is NULL, which can only happen once per device per migration.
 */
export async function setCurrentUserId(uid: string | null): Promise<void> {
  currentUserId = uid;
  if (uid) {
    await backfillUnscopedRows(uid);
  }
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

function requireUserId(op: string): string {
  if (!currentUserId) {
    throw new Error(
      `No authenticated user (op: ${op}). Sign in before calling user-scoped database operations.`,
    );
  }
  return currentUserId;
}

function requireHouseholdId(op: string): string {
  if (!currentHouseholdId) {
    throw new Error(
      `No active household (op: ${op}). Sign in / bootstrap a household before calling household-scoped database operations.`,
    );
  }
  return currentHouseholdId;
}

/**
 * Stamps any rows for this user that pre-date the household_id column
 * (household_id IS NULL) with the given household id. Every
 * pre-multi-household user only ever had one household, so this 1:1
 * backfill is always correct. Idempotent — only touches NULL rows.
 * Called once per household id, right after AuthContext resolves the
 * active hid; safe to call on every launch.
 */
async function backfillHouseholdIdForRows(uid: string, hid: string): Promise<void> {
  try {
    await db.runAsync(
      `UPDATE receipts SET household_id = ? WHERE household_id IS NULL AND user_id = ?`,
      [hid, uid],
    );
    await db.runAsync(
      `UPDATE settlements SET household_id = ? WHERE household_id IS NULL AND user_id = ?`,
      [hid, uid],
    );
    await db.runAsync(
      `UPDATE incomes SET household_id = ? WHERE household_id IS NULL AND user_id = ?`,
      [hid, uid],
    );
    await db.runAsync(
      `UPDATE savings_goals SET household_id = ? WHERE household_id IS NULL AND user_id = ?`,
      [hid, uid],
    );
  } catch (e) {
    // Columns may not exist yet on a fresh install where init hasn't
    // run — fine, there are no rows to backfill either. Logged (rather
    // than fully silent) because a REAL failure here means NULL rows
    // never get claimed by a household, and householdFilterSql's
    // `OR household_id IS NULL` fallback then lets them leak into
    // EVERY household's queries indefinitely, not just the original one.
    // eslint-disable-next-line no-console
    console.warn('[database] backfillHouseholdIdForRows failed:', (e as Error)?.message);
  }
}

/**
 * Set the active household and backfill any of this user's pre-existing
 * rows into it. Distinct from the raw setCurrentHouseholdId setter
 * (still exported below for the cases — sign-out, listener rewiring —
 * that don't want the backfill side effect) so callers that ARE
 * switching to a real bootstrapped household get the migration for
 * free. Safe/cheap to call every time: the backfill only touches NULL
 * rows.
 */
export async function bootstrapHouseholdId(uid: string, hid: string): Promise<void> {
  currentHouseholdId = hid;
  await backfillHouseholdIdForRows(uid, hid);
}

async function backfillUnscopedRows(uid: string): Promise<void> {
  // Stamps any pre-migration rows (user_id IS NULL) with the current
  // user's uid. On a device that has only ever been used by one user,
  // this correctly attributes their existing receipts to them. On a
  // device that gets a second user signing in BEFORE the first user
  // ever launched the upgraded app, both share the unscoped rows —
  // realistically an edge case (multi-user-on-same-device wasn't
  // supported by the old app), and the first-signed-in user wins.
  try {
    await db.runAsync(`UPDATE receipts SET user_id = ? WHERE user_id IS NULL`, [
      uid,
    ]);
    await db.runAsync(
      `UPDATE receipt_corrections SET user_id = ? WHERE user_id IS NULL`,
      [uid],
    );
  } catch {
    // The columns may not exist yet on a fresh install where init has
    // not yet run; that's fine, there are no rows to backfill either.
  }
}

export async function initDatabase(): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS receipts (
      id              TEXT PRIMARY KEY,
      store_name      TEXT NOT NULL,
      date            TEXT NOT NULL,
      total_amount    REAL NOT NULL DEFAULT 0,
      subtotal_amount REAL,
      tax_amount      REAL,
      category        TEXT NOT NULL DEFAULT 'Other',
      raw_text        TEXT,
      image_uri       TEXT,
      notes           TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS line_items (
      id          TEXT PRIMARY KEY,
      receipt_id  TEXT NOT NULL,
      name        TEXT NOT NULL,
      amount      REAL NOT NULL,
      category    TEXT,
      FOREIGN KEY (receipt_id) REFERENCES receipts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_receipts_date     ON receipts(date);
    CREATE INDEX IF NOT EXISTS idx_receipts_category ON receipts(category);
    CREATE INDEX IF NOT EXISTS idx_lineitems_receipt ON line_items(receipt_id);

    CREATE TABLE IF NOT EXISTS profiles (
      uid         TEXT PRIMARY KEY,
      first_name  TEXT NOT NULL,
      last_name   TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    -- "Settle up" ledger entries (see types/index.ts Settlement). Purely
    -- a balance offset between two household members — never a Receipt,
    -- never touched by reports/totals. Scoped by user_id like receipts:
    -- this device's signed-in user sees settlements from BOTH directions
    -- via household cloud sync, same pattern as receipts.
    CREATE TABLE IF NOT EXISTS settlements (
      id          TEXT PRIMARY KEY,
      from_uid    TEXT NOT NULL,
      to_uid      TEXT NOT NULL,
      amount_usd  REAL NOT NULL,
      created_at  TEXT NOT NULL,
      user_id     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_settlements_user ON settlements(user_id);

    -- Income ledger (docs/INCOME_FEATURE.md). Separate from receipts —
    -- money in, attributed to earned_by household member. USD-canonical
    -- amount_usd matches Settlement / Receipt conventions.
    CREATE TABLE IF NOT EXISTS incomes (
      id                 TEXT PRIMARY KEY,
      source_name        TEXT NOT NULL,
      date               TEXT NOT NULL,
      amount_usd         REAL NOT NULL DEFAULT 0,
      category           TEXT NOT NULL DEFAULT 'Other',
      earned_by          TEXT NOT NULL,
      notes              TEXT,
      original_currency  TEXT,
      recurring_json     TEXT,
      created_by         TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      user_id            TEXT NOT NULL,
      household_id       TEXT,
      is_recurring_occurrence INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_incomes_user ON incomes(user_id);
    CREATE INDEX IF NOT EXISTS idx_incomes_user_date ON incomes(user_id, date);

    -- Savings envelopes. Shadow-written to Firestore
    -- households/{hid}/savingsGoals (Phase D). Wiped with the account
    -- / household like incomes.
    CREATE TABLE IF NOT EXISTS savings_goals (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      target_usd    REAL NOT NULL DEFAULT 0,
      allocated_usd REAL NOT NULL DEFAULT 0,
      notes         TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      household_id  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_savings_goals_user ON savings_goals(user_id);

    -- Investment holdings (Premium). Personal and local-only: never shared
    -- with household members and not cloud-synced, so they are scoped by
    -- user_id alone. Wiped with the account.
    CREATE TABLE IF NOT EXISTS investment_accounts (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      kind            TEXT NOT NULL DEFAULT 'other',
      contributed_usd REAL NOT NULL DEFAULT 0,
      value_usd       REAL NOT NULL DEFAULT 0,
      notes           TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      user_id         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_investment_accounts_user ON investment_accounts(user_id);
    CREATE TABLE IF NOT EXISTS investment_snapshots (
      id              TEXT PRIMARY KEY,
      account_id      TEXT NOT NULL,
      date            TEXT NOT NULL,
      value_usd       REAL NOT NULL DEFAULT 0,
      contributed_usd REAL NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL,
      user_id         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_investment_snapshots_account ON investment_snapshots(account_id);
  `);

  // Review inbox. Receipts auto-created by the recurring processor land
  // here until the user confirms them. Local-only (not cloud-synced):
  // approving is a per-device convenience, and the receipt itself is
  // already a normal, synced row. Stale ids (receipt deleted elsewhere)
  // are harmless — every read joins against receipts.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS review_queue (
      receipt_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);

  // Migrations for columns added after initial release. ALTER TABLE has no
  // IF NOT EXISTS, so each ADD COLUMN is wrapped to swallow duplicate-column
  // errors on already-migrated databases.
  for (const sql of [
    `ALTER TABLE profiles    ADD COLUMN photo_uri        TEXT`,
    `ALTER TABLE receipts    ADD COLUMN subtotal_amount  REAL`,
    `ALTER TABLE receipts    ADD COLUMN tax_amount       REAL`,
    `ALTER TABLE receipts    ADD COLUMN category_tags    TEXT`,
    `ALTER TABLE line_items  ADD COLUMN category         TEXT`,
    // Per-user scoping. Nullable on existing rows; backfilled with
    // the current uid by setCurrentUserId() on the first sign-in
    // after the schema migration.
    `ALTER TABLE receipts             ADD COLUMN user_id  TEXT`,
    `ALTER TABLE receipt_corrections  ADD COLUMN user_id  TEXT`,
    // Phase 2: cached Cloud Storage URL of the receipt photo so we
    // don't re-upload it on every shadow-write. Filled in by the
    // post-upload writeback in setReceiptPhotoUrl().
    `ALTER TABLE receipts             ADD COLUMN photo_url TEXT`,
    // Splitwise-style split state (enabled flag, participant uids,
    // method, per-participant percent/amount values), serialized as
    // JSON. See Receipt['split'] in types/index.ts.
    `ALTER TABLE receipts             ADD COLUMN split_json TEXT`,
    // Per-item split participants (JSON array of participant ids).
    // See LineItem['splitWith'] in types/index.ts.
    `ALTER TABLE line_items           ADD COLUMN split_with TEXT`,
    // Auto-repeat config (frequency, next due date, end date), JSON.
    // See Receipt['recurring'] in types/index.ts.
    `ALTER TABLE receipts             ADD COLUMN recurring_json TEXT`,
    // Currency this receipt was actually entered in. See
    // Receipt['originalCurrency'] in types/index.ts.
    `ALTER TABLE receipts             ADD COLUMN original_currency TEXT`,
    // Effective rate (units of original_currency per canonical USD) used when
    // a foreign-currency receipt was entered with Premium live rates. Local
    // only, like original_currency. See Receipt['fxRate'].
    `ALTER TABLE receipts             ADD COLUMN fx_rate REAL`,
    // Optional verified phone number (E.164), added anytime from Settings.
    // See Profile['phone']/['phoneVerified'] in lib/profile.ts.
    `ALTER TABLE profiles             ADD COLUMN phone            TEXT`,
    `ALTER TABLE profiles             ADD COLUMN phone_verified   INTEGER`,
    // Who fronted the money for a split receipt (household member uid).
    // Defaults to the receipt's own creator when unset. See
    // Receipt['paidBy'] in types/index.ts.
    `ALTER TABLE receipts             ADD COLUMN paid_by          TEXT`,
    // Flags a receipt as generated by lib/recurring.ts's processor from
    // an active recurring template. See Receipt['isRecurringOccurrence']
    // in types/index.ts.
    `ALTER TABLE receipts             ADD COLUMN is_recurring_occurrence INTEGER`,
    // Multi-household support. Nullable on existing rows; backfilled
    // with the current active household id by bootstrapHouseholdId()
    // on the first sign-in after this schema migration — see
    // backfillHouseholdIdForRows above.
    `ALTER TABLE receipts             ADD COLUMN household_id     TEXT`,
    `ALTER TABLE settlements          ADD COLUMN household_id     TEXT`,
    // Whose expense this is (immutable creator uid, distinct from
    // paid_by which is who fronted the cash). See Receipt['createdBy']
    // in types/index.ts.
    `ALTER TABLE receipts             ADD COLUMN created_by       TEXT`,
    `ALTER TABLE incomes              ADD COLUMN is_recurring_occurrence INTEGER`,
  ]) {
    try {
      await db.execAsync(sql);
    } catch {
      // column already exists
    }
  }

  // Filtering index for the user-scoped lookups. Most read paths
  // (getAllReceipts, getReceiptsByMonth, searchReceipts) filter by
  // user_id; adding it ahead of an existing index keeps date-sorted
  // scans inside the user partition fast even when the table grows.
  try {
    await db.execAsync(
      `CREATE INDEX IF NOT EXISTS idx_receipts_user      ON receipts(user_id);
       CREATE INDEX IF NOT EXISTS idx_receipts_user_date ON receipts(user_id, date);
       CREATE INDEX IF NOT EXISTS idx_receipts_user_household_date
         ON receipts(user_id, household_id, date);
       CREATE INDEX IF NOT EXISTS idx_settlements_user_household
         ON settlements(user_id, household_id);
       CREATE INDEX IF NOT EXISTS idx_incomes_user_household_date
         ON incomes(user_id, household_id, date);
       CREATE INDEX IF NOT EXISTS idx_corrections_user_store
         ON receipt_corrections(user_id, store_name);`,
    );
  } catch {
    // Indices on a not-yet-migrated table — safe to ignore.
  }

  // Cache for the async classifier — keyed by the cleaned, lowercased item
  // name. Lets us avoid re-querying the backend for repeat items.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS item_classifications (
      cleaned_name TEXT PRIMARY KEY,
      category     TEXT NOT NULL,
      source       TEXT NOT NULL,  -- 'local' or 'remote'
      created_at   TEXT NOT NULL
    );
  `);

  // User-correction memory. When a user manually edits items after a
  // scan, we save the (storeName, rawOcr, finalItems) tuple here. On
  // the next scan from the same store the Gemini prompt loads the
  // 1-2 most recent corrections and includes them as in-context
  // examples — so the AI generalizes from how this specific user
  // treats their specific stores' receipt formats.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS receipt_corrections (
      id           TEXT PRIMARY KEY,
      store_name   TEXT NOT NULL,
      raw_ocr      TEXT NOT NULL,
      items_json   TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_corrections_store
      ON receipt_corrections(store_name);
  `);

  // Cache of Gemini parse results keyed by the OCR text hash. Lets
  // repeat scans of the same receipt (common during testing or when
  // the user retries after a transient error) reuse the prior result
  // instead of burning another quota request.
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS gemini_cache (
      text_hash    TEXT PRIMARY KEY,
      response_json TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
  `);
}

/**
 * Fast non-cryptographic hash (FNV-1a 32-bit). Good enough to key a
 * local cache where collisions are statistically irrelevant for the
 * data sizes we deal with (a few hundred scans over the app's life).
 */
function fnv1aHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Bump whenever the AI prompt / parsing logic changes so existing
// cache entries (which may contain BAD parses from the old prompt)
// no longer match. The shape of the cached payload is the same, but
// changing the hash input forces a fresh AI call for previously-cached
// OCRs and a clean re-cache under the new key.
const CACHE_KEY_VERSION = 'v2';

export function hashOcrText(rawOcr: string): string {
  // Normalize whitespace + case so trivially-different OCR runs of
  // the same receipt hit the same cache key. Prefix with the cache
  // version so a prompt change invalidates stale entries.
  const normalized = rawOcr.toLowerCase().replace(/\s+/g, ' ').trim();
  return fnv1aHash(`${CACHE_KEY_VERSION}|${normalized}`);
}

const GEMINI_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function getGeminiCachedResponse(
  rawOcr: string,
): Promise<string | null> {
  const key = hashOcrText(rawOcr);
  const row = await db.getFirstAsync<{ response_json: string; created_at: string }>(
    `SELECT response_json, created_at FROM gemini_cache WHERE text_hash=?`,
    [key],
  );
  if (!row) return null;
  const age = Date.now() - new Date(row.created_at).getTime();
  if (age > GEMINI_CACHE_TTL_MS) return null;
  return row.response_json;
}

export async function setGeminiCachedResponse(
  rawOcr: string,
  responseJson: string,
): Promise<void> {
  const key = hashOcrText(rawOcr);
  await db.runAsync(
    `INSERT INTO gemini_cache (text_hash, response_json, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(text_hash) DO UPDATE SET
       response_json = excluded.response_json,
       created_at    = excluded.created_at`,
    [key, responseJson, new Date().toISOString()],
  );
}

export async function saveCorrection(input: {
  storeName: string;
  rawOcr: string;
  items: import('../types').LineItem[];
}): Promise<void> {
  const uid = requireUserId('saveCorrection');
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const storeKey = input.storeName.trim().toLowerCase();
  if (!storeKey) return;
  // Cap stored OCR at ~3KB — long enough to capture the items block,
  // short enough that we can comfortably inject into a prompt.
  const truncatedOcr = input.rawOcr.slice(0, 3000);
  const itemsJson = JSON.stringify(
    input.items.map((it) => ({
      name: it.name,
      amount: it.amount,
      category: it.category,
    })),
  );
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO receipt_corrections (id, store_name, raw_ocr, items_json, created_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, storeKey, truncatedOcr, itemsJson, new Date().toISOString(), uid],
    );
    // Keep the table bounded — only the 10 most recent corrections per
    // store FOR THIS USER. A user with 100 stores ends up with at most
    // 1000 rows; multiplied across users this stays well under any
    // realistic device-storage concern.
    await db.runAsync(
      `DELETE FROM receipt_corrections
       WHERE store_name = ?
         AND user_id    = ?
         AND id NOT IN (
           SELECT id FROM receipt_corrections
           WHERE store_name = ?
             AND user_id    = ?
           ORDER BY created_at DESC
           LIMIT 10
         )`,
      [storeKey, uid, storeKey, uid],
    );
  });
}

export async function getRelevantCorrections(
  storeName: string,
  limit = 2,
): Promise<
  Array<{
    rawOcr: string;
    items: Array<{ name: string; amount: number; category?: string }>;
    createdAt: string;
  }>
> {
  const uid = requireUserId('getRelevantCorrections');
  const storeKey = storeName.trim().toLowerCase();
  if (!storeKey) return [];
  const rows = await db.getAllAsync<{
    raw_ocr: string;
    items_json: string;
    created_at: string;
  }>(
    `SELECT raw_ocr, items_json, created_at
     FROM receipt_corrections
     WHERE store_name = ?
       AND user_id    = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [storeKey, uid, limit],
  );
  const out: Array<{
    rawOcr: string;
    items: Array<{ name: string; amount: number; category?: string }>;
    createdAt: string;
  }> = [];
  for (const r of rows) {
    try {
      const items = JSON.parse(r.items_json);
      if (Array.isArray(items)) {
        out.push({ rawOcr: r.raw_ocr, items, createdAt: r.created_at });
      }
    } catch {
      // skip malformed rows
    }
  }
  return out;
}

export async function getCachedItemClassification(
  cleanedName: string,
): Promise<{ category: string; source: string } | null> {
  const row = await db.getFirstAsync<{ category: string; source: string }>(
    `SELECT category, source FROM item_classifications WHERE cleaned_name=?`,
    [cleanedName],
  );
  return row ?? null;
}

export async function setCachedItemClassification(
  cleanedName: string,
  category: string,
  source: 'local' | 'remote',
): Promise<void> {
  await db.runAsync(
    `INSERT INTO item_classifications (cleaned_name, category, source, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cleaned_name) DO UPDATE SET
       category   = excluded.category,
       source     = excluded.source,
       created_at = excluded.created_at`,
    [cleanedName, category, source, new Date().toISOString()],
  );
}

export async function updateLineItemCategory(
  itemId: string,
  category: string,
): Promise<void> {
  const uid = requireUserId('updateLineItemCategory');
  // Defense-in-depth: only update items whose parent receipt belongs to
  // the current user. Prevents a stale item id (or a malicious caller)
  // from reaching across user boundaries.
  await db.runAsync(
    `UPDATE line_items
     SET category = ?
     WHERE id = ?
       AND receipt_id IN (SELECT id FROM receipts WHERE user_id = ?)`,
    [category, itemId, uid],
  );
}

/**
 * Replace the line items on a receipt without touching any of the
 * receipt's header fields. Used by the per-item edit modal on the
 * receipt detail screen so item changes are saved immediately
 * (without forcing the user to also tap Save Changes at the bottom).
 */
export async function replaceLineItems(
  receiptId: string,
  items: import('../types').LineItem[],
): Promise<void> {
  const uid = requireUserId('replaceLineItems');
  const hidCheck = currentHouseholdId;
  // Verify the receipt belongs to the current user (and household)
  // before mutating its line items. If a stale receipt id leaks from a
  // previous user's session (e.g. via React state that wasn't
  // cleared), the lookup returns no row and we leave the data alone.
  const ownedRow = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM receipts WHERE id = ? AND user_id = ?${householdFilterSql(hidCheck)}`,
    hidCheck ? [receiptId, uid, hidCheck] : [receiptId, uid],
  );
  if (!ownedRow) return;
  const hid = currentHouseholdId;
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM line_items WHERE receipt_id=?`, [receiptId]);
    for (const item of items) {
      await db.runAsync(
        `INSERT INTO line_items (id, receipt_id, name, amount, category, split_with) VALUES (?, ?, ?, ?, ?, ?)`,
        [item.id, receiptId, item.name, item.amount, item.category ?? null, serializeSplitWith(item.splitWith)],
      );
    }
    // Bump the receipt's updated_at so list views know to re-render.
    await db.runAsync(
      `UPDATE receipts SET updated_at=? WHERE id=? AND user_id=?`,
      [new Date().toISOString(), receiptId, uid],
    );
  });
  // Reload the full receipt and shadow-write — replaceLineItems is
  // called in isolation from the per-item edit modal, which doesn't
  // go through updateReceipt, so without this hook line-item edits
  // would only land locally.
  if (hid) {
    const fresh = await getReceiptById(receiptId).catch(() => null);
    if (fresh) void syncReceiptToCloud(fresh, hid);
  }
}

/**
 * Deletes every receipt and income belonging to the CURRENTLY SIGNED-IN
 * user. Used by the deleteAccount flow. Other users' data on the same
 * device is untouched. Incomes are included so a deleted account does
 * not leave paycheck amounts, source names, notes, or savings
 * envelopes in SQLite.
 */
export async function deleteAllReceipts(): Promise<void> {
  const uid = requireUserId('deleteAllReceipts');
  await db.withTransactionAsync(async () => {
    // line_items cascade-delete via the FK once their parent receipts
    // are removed, but be explicit so we're not relying on PRAGMA
    // foreign_keys=ON being honoured by every SQLite build.
    await db.runAsync(
      `DELETE FROM line_items
       WHERE receipt_id IN (SELECT id FROM receipts WHERE user_id = ?)`,
      [uid],
    );
    await db.runAsync(`DELETE FROM receipts WHERE user_id = ?`, [uid]);
    await db.runAsync(`DELETE FROM receipt_corrections WHERE user_id = ?`, [uid]);
    await db.runAsync(`DELETE FROM incomes WHERE user_id = ?`, [uid]);
    await db.runAsync(`DELETE FROM savings_goals WHERE user_id = ?`, [uid]);
    await db.runAsync(`DELETE FROM investment_snapshots WHERE user_id = ?`, [uid]);
    await db.runAsync(`DELETE FROM investment_accounts WHERE user_id = ?`, [uid]);
  });
}

/**
 * Wipes every LOCAL row (any user_id) for one household on this device
 * — receipts, their line items, settlements, incomes, and savings
 *   envelopes. Called after
 * cloudSync.deleteHousehold has already removed the household's cloud
 * data, so this is just cleaning up this device's now-stale mirror.
 * Scoped by household_id only (not user_id): a shared household's local
 * mirror includes receipts synced in from OTHER members too, and all of
 * it is equally stale once the household itself is gone.
 */
export async function deleteAllRowsForHousehold(householdId: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `DELETE FROM line_items
       WHERE receipt_id IN (SELECT id FROM receipts WHERE household_id = ?)`,
      [householdId],
    );
    await db.runAsync(`DELETE FROM receipts WHERE household_id = ?`, [householdId]);
    await db.runAsync(`DELETE FROM settlements WHERE household_id = ?`, [householdId]);
    await db.runAsync(`DELETE FROM incomes WHERE household_id = ?`, [householdId]);
    await db.runAsync(`DELETE FROM savings_goals WHERE household_id = ?`, [householdId]);
  });
}

export interface ProfileRow {
  uid: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  phone_verified: number | null;
  created_at: string;
  updated_at: string;
}

export async function getProfileRow(uid: string): Promise<ProfileRow | null> {
  return (
    (await db.getFirstAsync<ProfileRow>(
      `SELECT uid, first_name, last_name, phone, phone_verified, created_at, updated_at FROM profiles WHERE uid=?`,
      [uid],
    )) ?? null
  );
}

export async function upsertProfileRow(row: ProfileRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO profiles (uid, first_name, last_name, phone, phone_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET
       first_name     = excluded.first_name,
       last_name      = excluded.last_name,
       phone          = excluded.phone,
       phone_verified = excluded.phone_verified,
       updated_at     = excluded.updated_at`,
    [
      row.uid,
      row.first_name,
      row.last_name,
      row.phone,
      row.phone_verified,
      row.created_at,
      row.updated_at,
    ],
  );
}

export async function deleteProfileRow(uid: string): Promise<void> {
  await db.runAsync(`DELETE FROM profiles WHERE uid=?`, [uid]);
}

export async function saveReceipt(receipt: Receipt): Promise<void> {
  const uid = requireUserId('saveReceipt');
  const tagsJson = serializeTags(receipt.categoryTags);
  // Cloud shadow-write fires AFTER the local commit succeeds. We
  // capture the receipt + household id outside the transaction so
  // the post-commit hook doesn't depend on any in-transaction state.
  const hid = currentHouseholdId;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO receipts
         (id, store_name, date, total_amount, subtotal_amount, tax_amount,
          category, category_tags, raw_text, image_uri, photo_url, notes,
          split_json, recurring_json, original_currency, paid_by, created_by,
          is_recurring_occurrence, created_at, updated_at, user_id, household_id, fx_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receipt.id,
        receipt.storeName,
        receipt.date,
        receipt.totalAmount,
        receipt.subtotalAmount ?? null,
        receipt.taxAmount ?? null,
        receipt.category,
        tagsJson,
        receipt.rawText ?? null,
        receipt.imageUri ?? null,
        receipt.photoUrl ?? null,
        receipt.notes ?? null,
        serializeSplit(receipt.split),
        serializeRecurring(receipt.recurring),
        receipt.originalCurrency ?? null,
        receipt.paidBy ?? uid,
        receipt.createdBy ?? uid,
        receipt.isRecurringOccurrence ? 1 : 0,
        receipt.createdAt,
        receipt.updatedAt,
        uid,
        hid,
        receipt.fxRate ?? null,
      ],
    );

    for (const item of receipt.lineItems ?? []) {
      await db.runAsync(
        `INSERT INTO line_items (id, receipt_id, name, amount, category, split_with) VALUES (?, ?, ?, ?, ?, ?)`,
        [item.id, receipt.id, item.name, item.amount, item.category ?? null, serializeSplitWith(item.splitWith)],
      );
    }
  });
  // Shadow-write to Firestore once the local commit is durable. Fire-
  // and-forget — failure here is logged, not surfaced (local already
  // succeeded, sync will retry on the next update or via the explicit
  // re-sync helpers).
  if (hid) {
    void syncReceiptToCloud(receipt, hid);
  }
}

export async function updateReceipt(receipt: Receipt): Promise<void> {
  const uid = requireUserId('updateReceipt');
  const hid = currentHouseholdId;
  // Stamp ONE fresh timestamp used for both the local row and the
  // cloud shadow-write below — callers (e.g. app/edit/[id].tsx's
  // handleSave) spread the OLD loaded `receipt` object without bumping
  // `updatedAt` themselves, so `receipt.updatedAt` here is stale. Cloud
  // sync used to serialize that stale value straight to Firestore,
  // which combined with upsertReceiptFromCloud's "skip if local is
  // already at least as fresh" guard meant another household member's
  // device could silently ignore a real, newer edit — exactly what
  // made a re-saved split still not show up cross-device.
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE receipts
       SET store_name=?, date=?, total_amount=?, subtotal_amount=?, tax_amount=?,
           category=?, category_tags=?, notes=?, split_json=?, recurring_json=?,
           original_currency=?, fx_rate=?, paid_by=?, updated_at=?
       WHERE id=? AND user_id=? AND (household_id IS NULL OR household_id=? OR ? IS NULL)`,
      [
        receipt.storeName,
        receipt.date,
        receipt.totalAmount,
        receipt.subtotalAmount ?? null,
        receipt.taxAmount ?? null,
        receipt.category,
        serializeTags(receipt.categoryTags),
        receipt.notes ?? null,
        serializeSplit(receipt.split),
        serializeRecurring(receipt.recurring),
        receipt.originalCurrency ?? null,
        receipt.fxRate ?? null,
        receipt.paidBy ?? uid,
        now,
        receipt.id,
        uid,
        hid,
        hid,
      ],
    );

    // Replace line items if the caller provided a new list. Caller can
    // omit `lineItems` to leave them unchanged (the previous behavior
    // that the dashboard relied on for non-item edits). Scope the
    // delete via the receipts table so a stale id from another user's
    // session can never wipe their items.
    if (receipt.lineItems !== undefined) {
      await db.runAsync(
        `DELETE FROM line_items
         WHERE receipt_id = ?
           AND receipt_id IN (SELECT id FROM receipts WHERE user_id = ?)`,
        [receipt.id, uid],
      );
      for (const item of receipt.lineItems) {
        await db.runAsync(
          `INSERT INTO line_items (id, receipt_id, name, amount, category, split_with) VALUES (?, ?, ?, ?, ?, ?)`,
          [item.id, receipt.id, item.name, item.amount, item.category ?? null, serializeSplitWith(item.splitWith)],
        );
      }
    }
  });
  // Mirror the updated state to Firestore. We resync the WHOLE
  // receipt (not a delta) so the cloud doc always matches what's on
  // the device — simpler reasoning, and the doc payload is tiny.
  // Pass `now`, not the caller's possibly-stale `receipt.updatedAt` —
  // see the comment above.
  if (hid) {
    void syncReceiptToCloud({ ...receipt, updatedAt: now }, hid);
  }
}

function serializeTags(tags: string[] | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  return JSON.stringify(tags);
}

function serializeSplitWith(ids: string[] | undefined): string | null {
  if (!ids || ids.length === 0) return null;
  return JSON.stringify(ids);
}

function parseSplitWith(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function serializeRecurring(recurring: Receipt['recurring'] | undefined): string | null {
  if (!recurring) return null;
  return JSON.stringify(recurring);
}

function parseRecurring(raw: string | null): Receipt['recurring'] | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Receipt['recurring'];
  } catch {
    return undefined;
  }
}

function serializeSplit(split: Receipt['split'] | undefined): string | null {
  if (!split) return null;
  return JSON.stringify(split);
}

function parseSplit(raw: string | null): Receipt['split'] | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Receipt['split'];
  } catch {
    return undefined;
  }
}

function parseTags(raw: string | null, fallbackCategory: string): string[] {
  if (!raw) return [fallbackCategory];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((t) => typeof t === 'string')) {
      return parsed.length ? parsed : [fallbackCategory];
    }
  } catch {
    // fall through
  }
  return [fallbackCategory];
}

export async function deleteReceipt(id: string): Promise<void> {
  const uid = requireUserId('deleteReceipt');
  const hid = currentHouseholdId;
  const res = await db.runAsync(
    `DELETE FROM receipts WHERE id=? AND user_id=? AND (household_id IS NULL OR household_id=? OR ? IS NULL)`,
    [id, uid, hid, hid],
  );
  if (res.changes > 0) {
    await db.runAsync(`DELETE FROM review_queue WHERE receipt_id=?`, [id]);
  }
  if (hid) {
    void syncReceiptDeletionToCloud(id, hid);
  }
}

/** Household filter fragment shared by every receipt/settlement read
 *  query below. When `hid` is set (the normal case once a household is
 *  bootstrapped), only rows in that household are visible — this is
 *  the core multi-household isolation guarantee. When `hid` is null
 *  (cloud sync unavailable on an old APK, or before bootstrap), the
 *  filter is skipped entirely, preserving the pre-multi-household
 *  "just show me my own rows" behavior. Rows that predate the
 *  household_id column (household_id IS NULL) are also matched once a
 *  real hid is active, since bootstrapHouseholdId's backfill may not
 *  have run yet — better to show a legacy row than hide it. */
function householdFilterSql(hid: string | null): string {
  return hid ? ` AND (household_id IS NULL OR household_id = ?)` : '';
}

export async function getAllReceipts(): Promise<Receipt[]> {
  const uid = requireUserId('getAllReceipts');
  const hid = currentHouseholdId;
  const rows = await db.getAllAsync<RawRow>(
    `SELECT * FROM receipts WHERE user_id=?${householdFilterSql(hid)} ORDER BY date DESC`,
    hid ? [uid, hid] : [uid],
  );
  return await attachLineItems(rows);
}

/** Queue a receipt for the review inbox (idempotent). */
export async function addToReviewQueue(receiptId: string): Promise<void> {
  requireUserId('addToReviewQueue');
  await db.runAsync(
    `INSERT OR IGNORE INTO review_queue (receipt_id, created_at) VALUES (?, ?)`,
    [receiptId, new Date().toISOString()],
  );
}

/** Receipts waiting for review in the active household, newest first. */
export async function getReviewQueueReceipts(): Promise<Receipt[]> {
  const uid = requireUserId('getReviewQueueReceipts');
  const hid = currentHouseholdId;
  const rows = await db.getAllAsync<RawRow>(
    `SELECT * FROM receipts
     WHERE user_id=? AND id IN (SELECT receipt_id FROM review_queue)${householdFilterSql(hid)}
     ORDER BY date DESC`,
    hid ? [uid, hid] : [uid],
  );
  return await attachLineItems(rows);
}

export async function getReviewQueueCount(): Promise<number> {
  const uid = requireUserId('getReviewQueueCount');
  const hid = currentHouseholdId;
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM receipts
     WHERE user_id=? AND id IN (SELECT receipt_id FROM review_queue)${householdFilterSql(hid)}`,
    hid ? [uid, hid] : [uid],
  );
  return row?.n ?? 0;
}

/** Mark one receipt as reviewed. */
export async function removeFromReviewQueue(receiptId: string): Promise<void> {
  requireUserId('removeFromReviewQueue');
  await db.runAsync(`DELETE FROM review_queue WHERE receipt_id=?`, [receiptId]);
}

/** Mark every queued receipt in the active household as reviewed. */
export async function clearReviewQueue(): Promise<void> {
  const uid = requireUserId('clearReviewQueue');
  const hid = currentHouseholdId;
  await db.runAsync(
    `DELETE FROM review_queue WHERE receipt_id IN (
       SELECT id FROM receipts WHERE user_id=?${householdFilterSql(hid)}
     )`,
    hid ? [uid, hid] : [uid],
  );
}

export async function getReceiptById(id: string): Promise<Receipt | null> {
  const uid = requireUserId('getReceiptById');
  const hid = currentHouseholdId;
  const row = await db.getFirstAsync<RawRow>(
    `SELECT * FROM receipts WHERE id=? AND user_id=?${householdFilterSql(hid)}`,
    hid ? [id, uid, hid] : [id, uid],
  );
  if (!row) return null;
  const [withItems] = await attachLineItems([row]);
  return withItems ?? rowToReceipt(row);
}

export async function getReceiptsByMonth(year: number, month: number): Promise<Receipt[]> {
  const uid = requireUserId('getReceiptsByMonth');
  const hid = currentHouseholdId;
  const monthParams = calendarMonthSqlParams(year, month);
  const rows  = await db.getAllAsync<RawRow>(
    `SELECT * FROM receipts
     WHERE user_id = ?${calendarMonthSql('date')}${householdFilterSql(hid)}
     ORDER BY date DESC`,
    hid ? [uid, ...monthParams, hid] : [uid, ...monthParams],
  );
  return await attachLineItems(rows);
}

export async function searchReceipts(query: string): Promise<Receipt[]> {
  const uid = requireUserId('searchReceipts');
  const hid = currentHouseholdId;
  const q = `%${query.toLowerCase()}%`;
  const rows = await db.getAllAsync<RawRow>(
    `SELECT * FROM receipts
     WHERE user_id = ?
       AND (lower(store_name) LIKE ? OR lower(category) LIKE ? OR lower(notes) LIKE ?)${householdFilterSql(hid)}
     ORDER BY date DESC`,
    hid ? [uid, q, q, q, hid] : [uid, q, q, q],
  );
  return await attachLineItems(rows);
}

/**
 * Batch-load line items for a list of receipt rows in a single query and
 * attach them to the resulting Receipt objects. Used by every receipt-list
 * query so the dashboard's per-category aggregation has the items it needs.
 */
async function attachLineItems(rows: RawRow[]): Promise<Receipt[]> {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => '?').join(',');
  const itemRows = await db.getAllAsync<{
    id: string;
    receipt_id: string;
    name: string;
    amount: number;
    category: string | null;
    split_with: string | null;
  }>(
    `SELECT id, receipt_id, name, amount, category, split_with
     FROM line_items WHERE receipt_id IN (${placeholders})`,
    rows.map((r) => r.id),
  );
  const byReceiptId = new Map<string, Receipt['lineItems']>();
  for (const r of itemRows) {
    const list = byReceiptId.get(r.receipt_id) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      amount: r.amount,
      // Default to 'Other' when the DB row has a null/empty category —
      // covers legacy items written before per-item categorization and
      // any AI/regex result that slipped through without a category.
      // Downstream code (dashboard, drilldown, edit) can always rely on
      // a non-empty category string.
      category:
        r.category && r.category.trim() ? r.category : 'Other',
      splitWith: parseSplitWith(r.split_with),
    });
    byReceiptId.set(r.receipt_id, list);
  }
  return rows.map((row) => ({
    ...rowToReceipt(row),
    lineItems: byReceiptId.get(row.id) ?? [],
  }));
}

// ─── helpers ────────────────────────────────────────────────────────────────

interface RawRow {
  id: string;
  store_name: string;
  date: string;
  total_amount: number;
  subtotal_amount: number | null;
  tax_amount: number | null;
  category: string;
  category_tags: string | null;
  raw_text: string | null;
  image_uri: string | null;
  photo_url: string | null;
  notes: string | null;
  split_json: string | null;
  recurring_json: string | null;
  original_currency: string | null;
  fx_rate: number | null;
  paid_by: string | null;
  created_by: string | null;
  is_recurring_occurrence: number | null;
  household_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToReceipt(row: RawRow): Receipt {
  return {
    id: row.id,
    householdId: row.household_id ?? undefined,
    storeName: row.store_name,
    date: row.date,
    totalAmount: row.total_amount,
    subtotalAmount: row.subtotal_amount ?? undefined,
    taxAmount: row.tax_amount ?? undefined,
    category: row.category as Receipt['category'],
    categoryTags: parseTags(row.category_tags, row.category),
    rawText: row.raw_text ?? undefined,
    imageUri: row.image_uri ?? undefined,
    photoUrl: row.photo_url ?? undefined,
    notes: row.notes ?? undefined,
    originalCurrency: (row.original_currency as Receipt['originalCurrency']) ?? undefined,
    fxRate: row.fx_rate ?? undefined,
    split: parseSplit(row.split_json),
    recurring: parseRecurring(row.recurring_json),
    paidBy: row.paid_by ?? undefined,
    createdBy: row.created_by ?? undefined,
    isRecurringOccurrence: row.is_recurring_occurrence === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Persist a successful Cloud Storage upload URL back into the local
 * row. Called by cloudSync.syncReceiptToCloud after uploadReceiptPhoto
 * succeeds, so the next save on this receipt sees photoUrl set and
 * skips the re-upload.
 */
export async function setReceiptPhotoUrl(
  receiptId: string,
  photoUrl: string,
): Promise<void> {
  const uid = requireUserId('setReceiptPhotoUrl');
  const hid = currentHouseholdId;
  await db.runAsync(
    `UPDATE receipts SET photo_url=? WHERE id=? AND user_id=? AND (household_id IS NULL OR household_id=? OR ? IS NULL)`,
    [photoUrl, receiptId, uid, hid, hid],
  );
}

// ─── cloud→local mirror helpers (Phase 3 listener) ───────────────────────
//
// Called by lib/cloudSync.ts's receipts subscription whenever Firestore
// reports a change from any device in the household. These paths are
// LOCAL-ONLY — they intentionally do NOT trigger the shadow-write back to
// cloud, since the data is ALREADY in cloud (that's what we just saw).
// Doing so would create an idle write-amplification loop and make the
// SQLite row's updated_at march forward on every snapshot for no reason.

type CloudReceiptShape = {
  id: string;
  storeName: string;
  date: string;
  totalAmount: number;
  subtotalAmount?: number | null;
  taxAmount?: number | null;
  category: string;
  categoryTags?: string[];
  rawText?: string | null;
  imageUri?: string | null;
  photoUrl?: string | null;
  notes?: string | null;
  split?: Receipt['split'];
  recurring?: Receipt['recurring'];
  paidBy?: string | null;
  createdBy?: string | null;
  isRecurringOccurrence?: boolean;
  lineItems?: Array<{
    id: string;
    name: string;
    amount: number;
    category?: string | null;
    splitWith?: string[];
  }>;
  createdAt: string;
  updatedAt: string;
};

export async function upsertReceiptFromCloud(
  cloud: CloudReceiptShape,
  uid: string,
  householdId: string,
): Promise<void> {
  // We accept uid explicitly because the listener fires regardless of
  // currentUserId — e.g. it might still be processing a snapshot batch
  // mid-sign-out. The uid is stamped from whichever household member
  // wrote the doc, which is fine because every member shares the row.

  // Guard against a STALE cloud snapshot clobbering a newer local edit.
  // syncReceiptToCloud (in cloudSync.ts) is fire-and-forget — if the app
  // gets killed (e.g. for a rebuild) right after a local save but
  // before that write reaches Firestore, the cloud doc is left behind
  // with the OLD data. subscribeToHouseholdReceipts does a full resync
  // on every fresh app launch, and without this check that stale
  // snapshot would silently overwrite the correct local row — this is
  // almost certainly why toggling "Split this expense" appeared to
  // reset after rebuilding: the split write hadn't reached the cloud
  // yet when the app was killed for the rebuild. Skip the whole upsert
  // if the local row is already at least as fresh.
  const existing = await db.getFirstAsync<{ updated_at: string }>(
    `SELECT updated_at FROM receipts WHERE id=?`,
    [cloud.id],
  );
  if (existing && existing.updated_at >= cloud.updatedAt) {
    return;
  }

  const tagsJson = cloud.categoryTags
    ? JSON.stringify(cloud.categoryTags)
    : null;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO receipts
         (id, store_name, date, total_amount, subtotal_amount, tax_amount,
          category, category_tags, raw_text, image_uri, photo_url, notes,
          split_json, recurring_json, paid_by, created_by, is_recurring_occurrence,
          created_at, updated_at, user_id, household_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         store_name      = excluded.store_name,
         date            = excluded.date,
         total_amount    = excluded.total_amount,
         subtotal_amount = excluded.subtotal_amount,
         tax_amount      = excluded.tax_amount,
         category        = excluded.category,
         category_tags   = excluded.category_tags,
         raw_text        = excluded.raw_text,
         image_uri       = excluded.image_uri,
         photo_url       = excluded.photo_url,
         notes           = excluded.notes,
         split_json      = excluded.split_json,
         recurring_json  = excluded.recurring_json,
         paid_by         = excluded.paid_by,
         is_recurring_occurrence = excluded.is_recurring_occurrence,
         updated_at      = excluded.updated_at,
         user_id         = excluded.user_id,
         household_id    = excluded.household_id`,
      // created_by is deliberately NOT in the ON CONFLICT UPDATE SET
      // above — it's the receipt's immutable creator, stamped once on
      // whichever device first inserts this row (either the original
      // creator locally, or the FIRST other device to see it via this
      // listener). A later resync must never let it drift.
      [
        cloud.id,
        cloud.storeName,
        cloud.date,
        cloud.totalAmount,
        cloud.subtotalAmount ?? null,
        cloud.taxAmount ?? null,
        cloud.category,
        tagsJson,
        cloud.rawText ?? null,
        cloud.imageUri ?? null,
        cloud.photoUrl ?? null,
        cloud.notes ?? null,
        serializeSplit(cloud.split),
        serializeRecurring(cloud.recurring),
        cloud.paidBy ?? null,
        cloud.createdBy ?? null,
        cloud.isRecurringOccurrence ? 1 : 0,
        cloud.createdAt,
        cloud.updatedAt,
        uid,
        householdId,
      ],
    );
    // Wipe + re-insert line items so the local set always matches the
    // cloud doc exactly. Simpler than diffing — and the row count per
    // receipt is small (typically <30).
    await db.runAsync(`DELETE FROM line_items WHERE receipt_id = ?`, [cloud.id]);
    for (const it of cloud.lineItems ?? []) {
      await db.runAsync(
        `INSERT INTO line_items (id, receipt_id, name, amount, category, split_with) VALUES (?, ?, ?, ?, ?, ?)`,
        [it.id, cloud.id, it.name, it.amount, it.category ?? null, serializeSplitWith(it.splitWith)],
      );
    }
  });
}

export async function deleteReceiptLocally(
  receiptId: string,
  uid: string,
  householdId: string,
): Promise<void> {
  // Scope the delete by uid + household so a malformed listener payload
  // can't wipe another user's (or another household's) receipt on this
  // same device.
  await db.runAsync(`DELETE FROM receipts WHERE id=? AND user_id=? AND household_id=?`, [
    receiptId,
    uid,
    householdId,
  ]);
}

// ─── settlements ("settle up") ─────────────────────────────────────────────

type SettlementRow = {
  id: string;
  from_uid: string;
  to_uid: string;
  amount_usd: number;
  created_at: string;
  household_id: string | null;
};

function rowToSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    fromUid: row.from_uid,
    toUid: row.to_uid,
    amountUsd: row.amount_usd,
    createdAt: row.created_at,
    householdId: row.household_id ?? undefined,
  };
}

/** Records a settle-up payment locally + shadow-writes it to Firestore
 *  (fire-and-forget, same pattern as saveReceipt). Immutable — there's
 *  no update/delete path, only new entries. */
export async function insertSettlement(settlement: Settlement): Promise<void> {
  const uid = requireUserId('insertSettlement');
  const hid = currentHouseholdId;
  await db.runAsync(
    `INSERT INTO settlements (id, from_uid, to_uid, amount_usd, created_at, user_id, household_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [settlement.id, settlement.fromUid, settlement.toUid, settlement.amountUsd, settlement.createdAt, uid, hid],
  );
  if (hid) {
    void syncSettlementToCloud(settlement, hid);
  }
}

export async function getAllSettlements(): Promise<Settlement[]> {
  const uid = requireUserId('getAllSettlements');
  const hid = currentHouseholdId;
  const rows = await db.getAllAsync<SettlementRow>(
    `SELECT * FROM settlements WHERE user_id=?${householdFilterSql(hid)} ORDER BY created_at DESC`,
    hid ? [uid, hid] : [uid],
  );
  return rows.map(rowToSettlement);
}

/**
 * Same data as getAllReceipts/getAllSettlements, but scoped to an
 * EXPLICIT household id rather than the current active one — used by
 * the Households screen's delete flow to check a household for
 * unsettled balances before deleting it, even when it isn't the one
 * currently active. Strict equality only (no "OR household_id IS
 * NULL" fallback, unlike householdFilterSql) since we're deliberately
 * targeting one specific household, not "whatever the active one is."
 */
export async function getAllReceiptsForHousehold(householdId: string): Promise<Receipt[]> {
  const uid = requireUserId('getAllReceiptsForHousehold');
  const rows = await db.getAllAsync<RawRow>(
    `SELECT * FROM receipts WHERE user_id=? AND household_id=? ORDER BY date DESC`,
    [uid, householdId],
  );
  return await attachLineItems(rows);
}

export async function getAllSettlementsForHousehold(householdId: string): Promise<Settlement[]> {
  const uid = requireUserId('getAllSettlementsForHousehold');
  const rows = await db.getAllAsync<SettlementRow>(
    `SELECT * FROM settlements WHERE user_id=? AND household_id=? ORDER BY created_at DESC`,
    [uid, householdId],
  );
  return rows.map(rowToSettlement);
}

/** Applies a settlement pulled from the household's Firestore collection
 *  — insert-only (id is the primary key, so a duplicate delivery from the
 *  listener is a silent no-op, not an error). */
export async function upsertSettlementFromCloud(
  cloud: Settlement,
  uid: string,
  householdId: string,
): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO settlements (id, from_uid, to_uid, amount_usd, created_at, user_id, household_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [cloud.id, cloud.fromUid, cloud.toUid, cloud.amountUsd, cloud.createdAt, uid, householdId],
  );
}

// ─── incomes (money in) ────────────────────────────────────────────────────

type IncomeRow = {
  id: string;
  source_name: string;
  date: string;
  amount_usd: number;
  category: string;
  earned_by: string;
  notes: string | null;
  original_currency: string | null;
  recurring_json: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  household_id: string | null;
  is_recurring_occurrence: number | null;
};

function rowToIncome(row: IncomeRow): Income {
  let recurring: Income['recurring'] | undefined;
  if (row.recurring_json) {
    try {
      recurring = JSON.parse(row.recurring_json) as Income['recurring'];
    } catch {
      recurring = undefined;
    }
  }
  return {
    id: row.id,
    sourceName: row.source_name,
    date: row.date,
    amountUsd: row.amount_usd,
    category: (row.category as IncomeCategory) || 'Other',
    earnedBy: row.earned_by,
    notes: row.notes ?? undefined,
    originalCurrency: (row.original_currency as Income['originalCurrency']) ?? undefined,
    recurring,
    isRecurringOccurrence: row.is_recurring_occurrence === 1,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    householdId: row.household_id ?? undefined,
  };
}

function incomeToRowParams(income: Income, uid: string, hid: string | null) {
  return [
    income.id,
    income.sourceName,
    income.date,
    income.amountUsd,
    income.category,
    income.earnedBy,
    income.notes ?? null,
    income.originalCurrency ?? null,
    income.recurring ? JSON.stringify(income.recurring) : null,
    income.createdBy ?? null,
    income.createdAt,
    income.updatedAt,
    uid,
    hid,
    income.isRecurringOccurrence ? 1 : 0,
  ];
}

/** Insert or replace a local income + shadow-write to Firestore. */
export async function saveIncome(income: Income): Promise<void> {
  const uid = requireUserId('saveIncome');
  const hid = currentHouseholdId;
  await db.runAsync(
    `INSERT OR REPLACE INTO incomes (
      id, source_name, date, amount_usd, category, earned_by, notes,
      original_currency, recurring_json, created_by, created_at, updated_at,
      user_id, household_id, is_recurring_occurrence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    incomeToRowParams(income, uid, hid),
  );
  if (hid) {
    void syncIncomeToCloud(income, hid);
  }
}

export async function getIncomeById(id: string): Promise<Income | null> {
  const uid = requireUserId('getIncomeById');
  const hid = currentHouseholdId;
  const row = await db.getFirstAsync<IncomeRow>(
    `SELECT * FROM incomes WHERE id=? AND user_id=?${householdFilterSql(hid)}`,
    hid ? [id, uid, hid] : [id, uid],
  );
  return row ? rowToIncome(row) : null;
}

export async function getAllIncomes(): Promise<Income[]> {
  const uid = requireUserId('getAllIncomes');
  const hid = currentHouseholdId;
  const rows = await db.getAllAsync<IncomeRow>(
    `SELECT * FROM incomes WHERE user_id=?${householdFilterSql(hid)} ORDER BY date DESC`,
    hid ? [uid, hid] : [uid],
  );
  return rows.map(rowToIncome);
}

/** Distinct source names, most recently used first (getAllIncomes is date DESC). */
export async function getRecentIncomeSourceNames(limit = 8): Promise<string[]> {
  const incomes = await getAllIncomes();
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of incomes) {
    const name = row.sourceName.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

export async function getIncomesByMonth(year: number, month: number): Promise<Income[]> {
  const uid = requireUserId('getIncomesByMonth');
  const hid = currentHouseholdId;
  const monthParams = calendarMonthSqlParams(year, month);
  const rows = await db.getAllAsync<IncomeRow>(
    `SELECT * FROM incomes
     WHERE user_id = ?${calendarMonthSql('date')}${householdFilterSql(hid)}
     ORDER BY date DESC`,
    hid ? [uid, ...monthParams, hid] : [uid, ...monthParams],
  );
  return rows.map(rowToIncome);
}

export async function searchIncomes(query: string): Promise<Income[]> {
  const uid = requireUserId('searchIncomes');
  const hid = currentHouseholdId;
  const q = `%${query.toLowerCase()}%`;
  const rows = await db.getAllAsync<IncomeRow>(
    `SELECT * FROM incomes
     WHERE user_id = ?
       AND (lower(source_name) LIKE ? OR lower(category) LIKE ? OR lower(notes) LIKE ?)${householdFilterSql(hid)}
     ORDER BY date DESC`,
    hid ? [uid, q, q, q, hid] : [uid, q, q, q],
  );
  return rows.map(rowToIncome);
}

export async function deleteIncome(id: string): Promise<void> {
  const uid = requireUserId('deleteIncome');
  const hid = currentHouseholdId;
  await db.runAsync(
    `DELETE FROM incomes WHERE id=? AND user_id=?${householdFilterSql(hid)}`,
    hid ? [id, uid, hid] : [id, uid],
  );
  if (hid) {
    void syncIncomeDeletionToCloud(id, hid);
  }
}

/** Apply an income pulled from Firestore. Skip when the local row is
 *  already at least as fresh — syncIncomeToCloud is fire-and-forget, so
 *  a killed write leaves a stale cloud doc that a later snapshot would
 *  otherwise INSERT OR REPLACE over the newer local amount/source/earnedBy. */
export async function upsertIncomeFromCloud(
  cloud: Income,
  uid: string,
  householdId: string,
): Promise<void> {
  const existing = await db.getFirstAsync<{ updated_at: string }>(
    `SELECT updated_at FROM incomes WHERE id=?`,
    [cloud.id],
  );
  if (existing && existing.updated_at >= (cloud.updatedAt ?? '')) {
    return;
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO incomes (
      id, source_name, date, amount_usd, category, earned_by, notes,
      original_currency, recurring_json, created_by, created_at, updated_at,
      user_id, household_id, is_recurring_occurrence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    incomeToRowParams(cloud, uid, householdId),
  );
}

export async function deleteIncomeFromCloud(
  incomeId: string,
  uid: string,
  householdId: string,
): Promise<void> {
  await db.runAsync(`DELETE FROM incomes WHERE id=? AND user_id=? AND household_id=?`, [
    incomeId,
    uid,
    householdId,
  ]);
}

// ─── savings goals / envelopes (Phase C, local-first) ──────────────────────

type SavingsGoalRow = {
  id: string;
  name: string;
  target_usd: number;
  allocated_usd: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  household_id: string | null;
};

function rowToSavingsGoal(row: SavingsGoalRow): SavingsGoal {
  return {
    id: row.id,
    name: row.name,
    targetUsd: row.target_usd,
    allocatedUsd: row.allocated_usd,
    notes: row.notes ?? undefined,
    householdId: row.household_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveSavingsGoal(goal: SavingsGoal): Promise<void> {
  const uid = requireUserId('saveSavingsGoal');
  const hid = currentHouseholdId;
  await db.runAsync(
    `INSERT OR REPLACE INTO savings_goals (
      id, name, target_usd, allocated_usd, notes, created_at, updated_at,
      user_id, household_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      goal.id,
      goal.name,
      goal.targetUsd,
      goal.allocatedUsd,
      goal.notes ?? null,
      goal.createdAt,
      goal.updatedAt,
      uid,
      hid,
    ],
  );
  if (hid) {
    void syncSavingsGoalToCloud(goal, hid);
  }
}

export async function getAllSavingsGoals(): Promise<SavingsGoal[]> {
  const uid = requireUserId('getAllSavingsGoals');
  const hid = currentHouseholdId;
  const rows = await db.getAllAsync<SavingsGoalRow>(
    `SELECT * FROM savings_goals WHERE user_id=?${householdFilterSql(hid)} ORDER BY created_at ASC`,
    hid ? [uid, hid] : [uid],
  );
  return rows.map(rowToSavingsGoal);
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  const uid = requireUserId('deleteSavingsGoal');
  const hid = currentHouseholdId;
  await db.runAsync(
    `DELETE FROM savings_goals WHERE id=? AND user_id=?${householdFilterSql(hid)}`,
    hid ? [id, uid, hid] : [id, uid],
  );
  if (hid) {
    void syncSavingsGoalDeletionToCloud(id, hid);
  }
}

/** Apply a savings goal pulled from Firestore. Skip when the local row
 *  is already at least as fresh — same updated_at guard as incomes. */
export async function upsertSavingsGoalFromCloud(
  cloud: SavingsGoal,
  uid: string,
  householdId: string,
): Promise<void> {
  const existing = await db.getFirstAsync<{ updated_at: string }>(
    `SELECT updated_at FROM savings_goals WHERE id=?`,
    [cloud.id],
  );
  if (existing && existing.updated_at >= (cloud.updatedAt ?? '')) {
    return;
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO savings_goals (
      id, name, target_usd, allocated_usd, notes, created_at, updated_at,
      user_id, household_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      cloud.id,
      cloud.name,
      cloud.targetUsd,
      cloud.allocatedUsd,
      cloud.notes ?? null,
      cloud.createdAt,
      cloud.updatedAt,
      uid,
      householdId,
    ],
  );
}

export async function deleteSavingsGoalFromCloud(
  goalId: string,
  uid: string,
  householdId: string,
): Promise<void> {
  await db.runAsync(`DELETE FROM savings_goals WHERE id=? AND user_id=? AND household_id=?`, [
    goalId,
    uid,
    householdId,
  ]);
}

// ─── investments (Premium, personal; synced to users/{uid}, never the household) ──

type InvestmentAccountRow = {
  id: string;
  name: string;
  kind: string;
  contributed_usd: number;
  value_usd: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function rowToInvestmentAccount(row: InvestmentAccountRow): InvestmentAccount {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as InvestmentKind,
    contributedUsd: row.contributed_usd,
    valueUsd: row.value_usd,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function saveInvestmentAccount(account: InvestmentAccount): Promise<void> {
  const uid = requireUserId('saveInvestmentAccount');
  await db.runAsync(
    `INSERT OR REPLACE INTO investment_accounts (
      id, name, kind, contributed_usd, value_usd, notes, created_at, updated_at, user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      account.id,
      account.name,
      account.kind,
      account.contributedUsd,
      account.valueUsd,
      account.notes ?? null,
      account.createdAt,
      account.updatedAt,
      uid,
    ],
  );
  void syncInvestmentAccountToCloud(account, uid);
}

export async function getAllInvestmentAccounts(): Promise<InvestmentAccount[]> {
  const uid = requireUserId('getAllInvestmentAccounts');
  const rows = await db.getAllAsync<InvestmentAccountRow>(
    `SELECT * FROM investment_accounts WHERE user_id=? ORDER BY created_at ASC`,
    [uid],
  );
  return rows.map(rowToInvestmentAccount);
}

export async function getInvestmentAccountById(id: string): Promise<InvestmentAccount | null> {
  const uid = requireUserId('getInvestmentAccountById');
  const row = await db.getFirstAsync<InvestmentAccountRow>(
    `SELECT * FROM investment_accounts WHERE id=? AND user_id=?`,
    [id, uid],
  );
  return row ? rowToInvestmentAccount(row) : null;
}

/** Deletes the account and its value history. */
export async function deleteInvestmentAccount(id: string): Promise<void> {
  const uid = requireUserId('deleteInvestmentAccount');
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM investment_snapshots WHERE account_id=? AND user_id=?`, [id, uid]);
    await db.runAsync(`DELETE FROM investment_accounts WHERE id=? AND user_id=?`, [id, uid]);
  });
  void syncInvestmentAccountDeletionToCloud(id, uid);
}

export async function addInvestmentSnapshot(snapshot: InvestmentSnapshot): Promise<void> {
  const uid = requireUserId('addInvestmentSnapshot');
  await db.runAsync(
    `INSERT OR REPLACE INTO investment_snapshots (
      id, account_id, date, value_usd, contributed_usd, created_at, user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.id,
      snapshot.accountId,
      snapshot.date,
      snapshot.valueUsd,
      snapshot.contributedUsd,
      snapshot.createdAt,
      uid,
    ],
  );
  void syncInvestmentSnapshotToCloud(snapshot, uid);
}

/** Every snapshot for the signed-in user, for the one-time cloud upload. */
export async function getAllInvestmentSnapshots(): Promise<InvestmentSnapshot[]> {
  const uid = requireUserId('getAllInvestmentSnapshots');
  const rows = await db.getAllAsync<{
    id: string;
    account_id: string;
    date: string;
    value_usd: number;
    contributed_usd: number;
    created_at: string;
  }>(`SELECT * FROM investment_snapshots WHERE user_id=?`, [uid]);
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    date: r.date,
    valueUsd: r.value_usd,
    contributedUsd: r.contributed_usd,
    createdAt: r.created_at,
  }));
}

// Cloud -> local appliers. They never write back to the cloud.

export async function upsertInvestmentAccountFromCloud(cloud: InvestmentAccount, uid: string): Promise<void> {
  const existing = await db.getFirstAsync<{ updated_at: string }>(
    `SELECT updated_at FROM investment_accounts WHERE id=? AND user_id=?`,
    [cloud.id, uid],
  );
  if (existing && existing.updated_at >= (cloud.updatedAt ?? '')) return;
  await db.runAsync(
    `INSERT OR REPLACE INTO investment_accounts (
      id, name, kind, contributed_usd, value_usd, notes, created_at, updated_at, user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [cloud.id, cloud.name, cloud.kind, cloud.contributedUsd, cloud.valueUsd, cloud.notes ?? null, cloud.createdAt, cloud.updatedAt, uid],
  );
}

export async function deleteInvestmentAccountFromCloud(id: string, uid: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM investment_snapshots WHERE account_id=? AND user_id=?`, [id, uid]);
    await db.runAsync(`DELETE FROM investment_accounts WHERE id=? AND user_id=?`, [id, uid]);
  });
}

export async function upsertInvestmentSnapshotFromCloud(cloud: InvestmentSnapshot, uid: string): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO investment_snapshots (
      id, account_id, date, value_usd, contributed_usd, created_at, user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [cloud.id, cloud.accountId, cloud.date, cloud.valueUsd, cloud.contributedUsd, cloud.createdAt, uid],
  );
}

export async function deleteInvestmentSnapshotFromCloud(id: string, uid: string): Promise<void> {
  await db.runAsync(`DELETE FROM investment_snapshots WHERE id=? AND user_id=?`, [id, uid]);
}

/** Newest first. */
export async function getInvestmentSnapshots(accountId: string): Promise<InvestmentSnapshot[]> {
  const uid = requireUserId('getInvestmentSnapshots');
  const rows = await db.getAllAsync<{
    id: string;
    account_id: string;
    date: string;
    value_usd: number;
    contributed_usd: number;
    created_at: string;
  }>(
    `SELECT * FROM investment_snapshots WHERE account_id=? AND user_id=?
     ORDER BY date DESC, created_at DESC`,
    [accountId, uid],
  );
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    date: r.date,
    valueUsd: r.value_usd,
    contributedUsd: r.contributed_usd,
    createdAt: r.created_at,
  }));
}
