import {
  computeReceiptShare,
  computeReceiptNet,
  computeSettlementNet,
  getSettlementsForMemberPair,
  computeMemberBalances,
  getReceiptsForMemberPair,
} from '../lib/balances';
import { Receipt, Settlement, LineItem } from '../types';
import { HouseholdMember } from '../lib/cloudSync';

const SELF = 'self-uid';
const BOB = 'bob-uid';
const CAROL = 'carol-uid';

const baseReceipt = (overrides: Partial<Receipt>): Receipt => ({
  id: 'r1',
  storeName: 'Test',
  date: '2026-01-01',
  totalAmount: 100,
  category: 'Groceries',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('computeReceiptShare', () => {
  it('returns 0 when split is disabled or missing', () => {
    const r = baseReceipt({});
    expect(computeReceiptShare(r, BOB, SELF)).toBe(0);
    const r2 = baseReceipt({ split: { enabled: false, method: 'equal', participantIds: ['self', BOB] } });
    expect(computeReceiptShare(r2, BOB, SELF)).toBe(0);
  });

  it('returns 0 when target is not a participant', () => {
    const r = baseReceipt({
      split: { enabled: true, method: 'equal', participantIds: ['self', BOB] },
    });
    expect(computeReceiptShare(r, CAROL, SELF)).toBe(0);
  });

  it('equal split divides evenly among resolved participants', () => {
    const r = baseReceipt({
      totalAmount: 90,
      split: { enabled: true, method: 'equal', participantIds: ['self', BOB, CAROL] },
    });
    expect(computeReceiptShare(r, BOB, SELF)).toBeCloseTo(30, 5);
    expect(computeReceiptShare(r, SELF, SELF)).toBeCloseTo(30, 5);
  });

  it('resolves the literal "self" participant id to selfUid', () => {
    const r = baseReceipt({
      totalAmount: 50,
      split: { enabled: true, method: 'equal', participantIds: ['self', BOB] },
    });
    // BOB's share should be computed against 2 participants, not fail
    // to resolve 'self' as a separate distinct id.
    expect(computeReceiptShare(r, BOB, SELF)).toBeCloseTo(25, 5);
  });

  it('percent split uses split.values keyed by participant (self for the signed-in user)', () => {
    const r = baseReceipt({
      totalAmount: 200,
      split: {
        enabled: true,
        method: 'percent',
        participantIds: ['self', BOB],
        values: { self: 30, [BOB]: 70 },
      },
    });
    expect(computeReceiptShare(r, BOB, SELF)).toBeCloseTo(140, 5);
    expect(computeReceiptShare(r, SELF, SELF)).toBeCloseTo(60, 5);
  });

  it('percent, amount and shares splits read values keyed by real uid (what the app saves today)', () => {
    const base = { enabled: true as const, participantIds: [SELF, BOB] };
    const pct = baseReceipt({ totalAmount: 200, split: { ...base, method: 'percent', values: { [SELF]: 30, [BOB]: 70 } } });
    expect(computeReceiptShare(pct, SELF, SELF)).toBeCloseTo(60, 5);
    expect(computeReceiptShare(pct, BOB, SELF)).toBeCloseTo(140, 5);
    const amt = baseReceipt({ totalAmount: 200, split: { ...base, method: 'amount', values: { [SELF]: 50, [BOB]: 150 } } });
    expect(computeReceiptShare(amt, SELF, SELF)).toBeCloseTo(50, 5);
    const sh = baseReceipt({ totalAmount: 300, split: { ...base, method: 'shares', values: { [SELF]: 1, [BOB]: 2 } } });
    expect(computeReceiptShare(sh, SELF, SELF)).toBeCloseTo(100, 5);
    expect(computeReceiptShare(sh, BOB, SELF)).toBeCloseTo(200, 5);
  });

  it('percent split defaults to 0 when no value set for a participant', () => {
    const r = baseReceipt({
      totalAmount: 200,
      split: { enabled: true, method: 'percent', participantIds: ['self', BOB], values: {} },
    });
    expect(computeReceiptShare(r, BOB, SELF)).toBe(0);
  });

  it('amount split uses split.values as a flat dollar amount', () => {
    const r = baseReceipt({
      totalAmount: 200,
      split: {
        enabled: true,
        method: 'amount',
        participantIds: ['self', BOB],
        values: { self: 50, [BOB]: 150 },
      },
    });
    expect(computeReceiptShare(r, BOB, SELF)).toBe(150);
    expect(computeReceiptShare(r, SELF, SELF)).toBe(50);
  });

  it('shares split divides the total proportionally by share count (Splitwise-style)', () => {
    const r = baseReceipt({
      totalAmount: 300,
      split: {
        enabled: true,
        method: 'shares',
        participantIds: ['self', BOB],
        values: { self: 1, [BOB]: 2 },
      },
    });
    // 1:2 shares of 300 -> 100 / 200
    expect(computeReceiptShare(r, SELF, SELF)).toBeCloseTo(100, 5);
    expect(computeReceiptShare(r, BOB, SELF)).toBeCloseTo(200, 5);
  });

  it('shares split with a third participant divides proportionally across all three', () => {
    const r = baseReceipt({
      totalAmount: 500,
      split: {
        enabled: true,
        method: 'shares',
        participantIds: ['self', BOB, CAROL],
        values: { self: 2, [BOB]: 1, [CAROL]: 2 },
      },
    });
    // 2:1:2 shares of 500 -> 200 / 100 / 200
    expect(computeReceiptShare(r, SELF, SELF)).toBeCloseTo(200, 5);
    expect(computeReceiptShare(r, BOB, SELF)).toBeCloseTo(100, 5);
    expect(computeReceiptShare(r, CAROL, SELF)).toBeCloseTo(200, 5);
  });

  it('shares split accepts decimal share counts, not just whole numbers', () => {
    const r = baseReceipt({
      totalAmount: 300,
      split: {
        enabled: true,
        method: 'shares',
        participantIds: ['self', BOB],
        values: { self: 0.5, [BOB]: 0.7 },
      },
    });
    // 0.5:0.7 shares of 300 -> 125 / 175
    expect(computeReceiptShare(r, SELF, SELF)).toBeCloseTo(125, 5);
    expect(computeReceiptShare(r, BOB, SELF)).toBeCloseTo(175, 5);
  });

  it('shares split defaults to 0 when no shares are set for anyone', () => {
    const r = baseReceipt({
      totalAmount: 200,
      split: { enabled: true, method: 'shares', participantIds: ['self', BOB], values: {} },
    });
    expect(computeReceiptShare(r, BOB, SELF)).toBe(0);
    expect(computeReceiptShare(r, SELF, SELF)).toBe(0);
  });

  it('line-item splitWith overrides take priority over the receipt-level method', () => {
    const lineItems: LineItem[] = [
      { id: '1', name: 'Milk', amount: 40, category: 'Groceries', splitWith: ['self', BOB] },
      { id: '2', name: 'Shoes', amount: 60, category: 'Clothing', splitWith: [BOB] },
    ];
    const r = baseReceipt({
      totalAmount: 100,
      split: { enabled: true, method: 'equal', participantIds: ['self', BOB] },
      lineItems,
    });
    // Item 1 split 50/50 between self and Bob (20 each); item 2 entirely
    // to Bob (60). Bob's total: 20 + 60 = 80.
    expect(computeReceiptShare(r, BOB, SELF)).toBeCloseTo(80, 5);
    expect(computeReceiptShare(r, SELF, SELF)).toBeCloseTo(20, 5);
  });

  it('items without their own splitWith fall back to the receipt-level participants when others have overrides', () => {
    const lineItems: LineItem[] = [
      { id: '1', name: 'Milk', amount: 30, category: 'Groceries' }, // no override
      { id: '2', name: 'Gadget', amount: 70, category: 'Electronics', splitWith: [BOB] },
    ];
    const r = baseReceipt({
      totalAmount: 100,
      split: { enabled: true, method: 'equal', participantIds: ['self', BOB] },
      lineItems,
    });
    // Item 1 falls back to resolvedParticipants ['self', BOB] -> 15 each.
    // Item 2 goes entirely to BOB -> 70.
    expect(computeReceiptShare(r, BOB, SELF)).toBeCloseTo(85, 5);
    expect(computeReceiptShare(r, SELF, SELF)).toBeCloseTo(15, 5);
  });

  it('a target not included in an overridden item receives nothing from that item', () => {
    const lineItems: LineItem[] = [
      { id: '1', name: 'Solo item', amount: 40, category: 'Other', splitWith: [BOB] },
    ];
    const r = baseReceipt({
      totalAmount: 40,
      split: { enabled: true, method: 'equal', participantIds: ['self', BOB, CAROL] },
      lineItems,
    });
    expect(computeReceiptShare(r, CAROL, SELF)).toBe(0);
  });
});

describe('computeReceiptNet', () => {
  it('returns 0 when split is disabled', () => {
    const r = baseReceipt({});
    expect(computeReceiptNet(r, SELF, BOB)).toBe(0);
  });

  it('returns 0 when either party is not a participant', () => {
    const r = baseReceipt({
      split: { enabled: true, method: 'equal', participantIds: ['self', CAROL] },
    });
    expect(computeReceiptNet(r, SELF, BOB)).toBe(0);
  });

  it('self paid: positive = memberUid owes self', () => {
    const r = baseReceipt({
      totalAmount: 100,
      paidBy: SELF,
      split: { enabled: true, method: 'equal', participantIds: ['self', BOB] },
    });
    expect(computeReceiptNet(r, SELF, BOB)).toBeCloseTo(50, 5);
  });

  it('member paid: negative = self owes memberUid', () => {
    const r = baseReceipt({
      totalAmount: 100,
      paidBy: BOB,
      split: { enabled: true, method: 'equal', participantIds: ['self', BOB] },
    });
    expect(computeReceiptNet(r, SELF, BOB)).toBeCloseTo(-50, 5);
  });

  it('defaults to "self paid" when paidBy is absent (legacy receipts)', () => {
    const r = baseReceipt({
      totalAmount: 100,
      split: { enabled: true, method: 'equal', participantIds: ['self', BOB] },
    });
    expect(computeReceiptNet(r, SELF, BOB)).toBeCloseTo(50, 5);
  });

  it('third-party payer contributes 0 to the self<->member pair', () => {
    const r = baseReceipt({
      totalAmount: 100,
      paidBy: CAROL,
      split: { enabled: true, method: 'equal', participantIds: ['self', BOB, CAROL] },
    });
    expect(computeReceiptNet(r, SELF, BOB)).toBe(0);
  });

  describe('not split, but fronted by someone else (createdBy/paidBy)', () => {
    it('memberUid paid for a personal expense that belongs to self: self owes the full amount', () => {
      const r = baseReceipt({ totalAmount: 100, createdBy: SELF, paidBy: BOB });
      expect(computeReceiptNet(r, SELF, BOB)).toBe(-100);
    });

    it('self paid for a personal expense that belongs to memberUid: memberUid owes the full amount', () => {
      const r = baseReceipt({ totalAmount: 100, createdBy: BOB, paidBy: SELF });
      expect(computeReceiptNet(r, SELF, BOB)).toBe(100);
    });

    it('returns 0 when createdBy and paidBy are the same person (no debt)', () => {
      const r = baseReceipt({ totalAmount: 100, createdBy: SELF, paidBy: SELF });
      expect(computeReceiptNet(r, SELF, BOB)).toBe(0);
    });

    it('returns 0 when createdBy is set but paidBy is absent', () => {
      const r = baseReceipt({ totalAmount: 100, createdBy: SELF });
      expect(computeReceiptNet(r, SELF, BOB)).toBe(0);
    });

    it('returns 0 for legacy receipts with neither createdBy nor paidBy', () => {
      const r = baseReceipt({ totalAmount: 100 });
      expect(computeReceiptNet(r, SELF, BOB)).toBe(0);
    });

    it("doesn't involve a third party's personal expense", () => {
      const r = baseReceipt({ totalAmount: 100, createdBy: CAROL, paidBy: BOB });
      expect(computeReceiptNet(r, SELF, BOB)).toBe(0);
    });
  });
});

describe('computeSettlementNet', () => {
  const mk = (fromUid: string, toUid: string, amountUsd: number): Settlement => ({
    id: 's1',
    fromUid,
    toUid,
    amountUsd,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  it('self -> member payment nets positive (self owes less)', () => {
    expect(computeSettlementNet(mk(SELF, BOB, 20), SELF, BOB)).toBe(20);
  });

  it('member -> self payment nets negative (member owes less)', () => {
    expect(computeSettlementNet(mk(BOB, SELF, 20), SELF, BOB)).toBe(-20);
  });

  it('returns 0 for a settlement not involving this exact pair', () => {
    expect(computeSettlementNet(mk(BOB, CAROL, 20), SELF, BOB)).toBe(0);
  });
});

describe('getSettlementsForMemberPair', () => {
  it('filters to only settlements between self and memberUid, both directions', () => {
    const settlements: Settlement[] = [
      { id: '1', fromUid: SELF, toUid: BOB, amountUsd: 10, createdAt: '' },
      { id: '2', fromUid: BOB, toUid: SELF, amountUsd: 5, createdAt: '' },
      { id: '3', fromUid: SELF, toUid: CAROL, amountUsd: 15, createdAt: '' },
    ];
    const result = getSettlementsForMemberPair(settlements, SELF, BOB);
    expect(result.map((s) => s.id)).toEqual(['1', '2']);
  });
});

describe('getReceiptsForMemberPair', () => {
  it('returns only split-enabled receipts involving both self and memberUid', () => {
    const receipts: Receipt[] = [
      baseReceipt({ id: 'a', split: { enabled: true, method: 'equal', participantIds: ['self', BOB] } }),
      baseReceipt({ id: 'b', split: { enabled: true, method: 'equal', participantIds: ['self', CAROL] } }),
      baseReceipt({ id: 'c', split: { enabled: false, method: 'equal', participantIds: ['self', BOB] } }),
      baseReceipt({ id: 'd' }),
    ];
    const result = getReceiptsForMemberPair(receipts, SELF, BOB);
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('also includes a non-split receipt fronted by someone else (createdBy/paidBy), matching computeReceiptNet', () => {
    const receipts: Receipt[] = [
      baseReceipt({ id: 'a', totalAmount: 50, createdBy: SELF, paidBy: BOB }),
      // Same pair but no debt (createdBy === paidBy) — correctly excluded.
      baseReceipt({ id: 'b', totalAmount: 20, createdBy: SELF, paidBy: SELF }),
      // A third person's personal expense — doesn't involve this pair.
      baseReceipt({ id: 'c', totalAmount: 30, createdBy: CAROL, paidBy: BOB }),
    ];
    const result = getReceiptsForMemberPair(receipts, SELF, BOB);
    expect(result.map((r) => r.id)).toEqual(['a']);
  });
});

describe('computeMemberBalances', () => {
  const members: HouseholdMember[] = [
    { uid: SELF, email: null, displayName: 'Me', role: 'owner', isYou: true },
    { uid: BOB, email: null, displayName: 'Bob', role: 'member', isYou: false },
    { uid: CAROL, email: null, displayName: 'Carol', role: 'member', isYou: false },
  ];

  it('excludes self from the returned balances', () => {
    const result = computeMemberBalances([], [], SELF, members);
    expect(result.map((b) => b.memberUid).sort()).toEqual([BOB, CAROL].sort());
  });

  it('sums receipt nets and settlement nets per member', () => {
    const receipts: Receipt[] = [
      baseReceipt({
        id: 'r1',
        totalAmount: 100,
        paidBy: SELF,
        split: { enabled: true, method: 'equal', participantIds: ['self', BOB] },
      }),
      baseReceipt({
        id: 'r2',
        totalAmount: 40,
        paidBy: BOB,
        split: { enabled: true, method: 'equal', participantIds: ['self', BOB] },
      }),
    ];
    const settlements: Settlement[] = [
      { id: 's1', fromUid: SELF, toUid: BOB, amountUsd: 10, createdAt: '' },
    ];
    const result = computeMemberBalances(receipts, settlements, SELF, members);
    const bob = result.find((b) => b.memberUid === BOB)!;
    // r1: bob owes self 50. r2: self owes bob 20. settlement: self paid
    // bob 10, so self owes 10 less => net += 10.
    // 50 - 20 + 10 = 40
    expect(bob.netUsd).toBeCloseTo(40, 5);
    expect(bob.receiptIds.sort()).toEqual(['r1', 'r2'].sort());

    const carol = result.find((b) => b.memberUid === CAROL)!;
    expect(carol.netUsd).toBe(0);
    expect(carol.receiptIds).toEqual([]);
  });

  it('returns all-zero balances when there are no receipts or settlements', () => {
    const result = computeMemberBalances([], [], SELF, members);
    for (const b of result) {
      expect(b.netUsd).toBe(0);
      expect(b.receiptIds).toEqual([]);
    }
  });
});
