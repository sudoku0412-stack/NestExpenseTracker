import { checkItemsAgainstSubtotal } from '../lib/itemsTotalCheck';
import { LineItem } from '../types';

const li = (name: string, amount: number): LineItem => ({
  id: name.toLowerCase().replace(/\s+/g, '-'),
  name,
  amount,
  category: 'Groceries',
});

describe('checkItemsAgainstSubtotal', () => {
  it('returns ok when items sum exactly equals the subtotal', () => {
    const r = checkItemsAgainstSubtotal([li('a', 5.0), li('b', 3.5)], 8.5);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sum).toBeCloseTo(8.5, 2);
  });

  it('returns ok within the $0.50 rounding tolerance', () => {
    // 5.00 + 3.51 = 8.51 vs subtotal 8.50 → diff = 0.01 < 0.50, OK
    const r = checkItemsAgainstSubtotal([li('a', 5.0), li('b', 3.51)], 8.5);
    expect(r.ok).toBe(true);
  });

  it('returns ok with skipped flag when subtotal is null', () => {
    const r = checkItemsAgainstSubtotal([li('a', 5.0)], null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.skipped).toBe(true);
  });

  it('flags a mismatch when items sum greater than subtotal beyond tolerance', () => {
    const r = checkItemsAgainstSubtotal(
      [li('Apple', 5.0), li('Banana', 3.0), li('Cherry', 4.0)],
      8.0,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diff).toBeCloseTo(4.0, 2);
      expect(r.hint).toContain('Cherry'); // suspect-by-amount match
    }
  });

  it('flags a mismatch when items sum less than subtotal beyond tolerance', () => {
    const r = checkItemsAgainstSubtotal([li('Apple', 5.0), li('Banana', 3.0)], 12.0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diff).toBeCloseTo(-4.0, 2);
      expect(r.hint).toMatch(/missing|mistyped/i);
    }
  });

  it('does not crash on an empty items list', () => {
    const r = checkItemsAgainstSubtotal([], 10.0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.sum).toBe(0);
  });

  it('accepts a $0.50 difference and rejects $0.51', () => {
    expect(checkItemsAgainstSubtotal([li('a', 10.5)], 10).ok).toBe(true);
    const over = checkItemsAgainstSubtotal([li('a', 10.51)], 10);
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.diff).toBeCloseTo(0.51, 2);
  });

  it('skips the check when the printed subtotal is missing, zero, or not finite', () => {
    expect(checkItemsAgainstSubtotal([li('a', 5)], undefined)).toMatchObject({
      ok: true,
      skipped: true,
      sum: 5,
    });
    expect(checkItemsAgainstSubtotal([li('a', 5)], 0)).toMatchObject({ ok: true, skipped: true });
    expect(checkItemsAgainstSubtotal([li('a', 5)], -12)).toMatchObject({ ok: true, skipped: true });
    expect(checkItemsAgainstSubtotal([li('a', 5)], Number.NaN)).toMatchObject({
      ok: true,
      skipped: true,
    });
  });

  it('uses a generic over hint when no single line matches the extra amount', () => {
    const r = checkItemsAgainstSubtotal([li('Milk', 3), li('Bread', 4)], 5);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.hint).not.toMatch(/Milk|Bread/);
      expect(r.hint.toLowerCase()).toMatch(/over|more|high/);
    }
  });
});
