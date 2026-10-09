import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CurrencyCode } from '@app/lib/currency';
import type { Income, Receipt, Settlement } from '@app/types';
import { useAuth } from './auth';
import { db } from './firebase';

export interface Member {
  uid: string;
  name: string;
  email: string | null;
}

export interface CustomCategory {
  name: string;
  color?: string;
}

interface DataValue {
  ready: boolean;
  error: string | null;
  householdId: string | null;
  members: Member[];
  memberName: (uid: string | undefined | null) => string;
  budgets: Record<string, number>;
  customCategories: CustomCategory[];
  receipts: Receipt[];
  incomes: Income[];
  settlements: Settlement[];
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
}

const Ctx = createContext<DataValue | null>(null);
const CURRENCY_KEY = 'nest-currency';

function readCurrency(): CurrencyCode {
  try {
    return (localStorage.getItem(CURRENCY_KEY) as CurrencyCode) || 'USD';
  } catch {
    return 'USD';
  }
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function toReceipt(id: string, d: DocumentData, householdId: string): Receipt {
  const items = Array.isArray(d.lineItems) ? d.lineItems : [];
  return {
    id,
    storeName: str(d.storeName, 'Unknown'),
    date: str(d.date),
    totalAmount: num(d.totalAmount),
    subtotalAmount: d.subtotalAmount ?? undefined,
    taxAmount: d.taxAmount ?? undefined,
    category: str(d.category, 'Other'),
    categoryTags: Array.isArray(d.categoryTags) ? d.categoryTags : undefined,
    notes: d.notes ?? undefined,
    photoUrl: d.photoUrl ?? undefined,
    originalCurrency: d.originalCurrency ?? undefined,
    paidBy: d.paidBy ?? undefined,
    createdBy: d.createdBy ?? undefined,
    split: d.split ?? undefined,
    recurring: d.recurring ?? undefined,
    isRecurringOccurrence: Boolean(d.isRecurringOccurrence),
    lineItems: items.map((it: DocumentData, i: number) => ({
      id: str(it.id, `${id}-${i}`),
      name: str(it.name),
      amount: num(it.amount),
      category: it.category ?? undefined,
      splitWith: it.splitWith ?? undefined,
    })),
    householdId,
    createdAt: str(d.createdAt),
    updatedAt: str(d.updatedAt),
  };
}

function toIncome(id: string, d: DocumentData, householdId: string): Income {
  return {
    id,
    sourceName: str(d.sourceName, 'Income'),
    date: str(d.date),
    amountUsd: num(d.amountUsd),
    category: (d.category as Income['category']) ?? 'Other',
    earnedBy: str(d.earnedBy),
    notes: d.notes ?? undefined,
    originalCurrency: d.originalCurrency ?? undefined,
    recurring: d.recurring ?? undefined,
    isRecurringOccurrence: Boolean(d.isRecurringOccurrence),
    createdBy: d.createdBy ?? undefined,
    householdId,
    createdAt: str(d.createdAt),
    updatedAt: str(d.updatedAt),
  };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [loaded, setLoaded] = useState({ receipts: false, incomes: false, settlements: false });
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrencyState] = useState<CurrencyCode>(readCurrency);

  // 1. Which household does this user belong to? (written by the mobile app)
  useEffect(() => {
    setHouseholdId(null);
    setError(null);
    if (!user) return;
    let cancelled = false;
    getDoc(doc(db, 'users', user.uid))
      .then((snap) => {
        if (cancelled) return;
        const hid = snap.data()?.householdId as string | undefined;
        if (hid) setHouseholdId(hid);
        else setError('No household found for this account. Sign in once on the mobile app first.');
      })
      .catch(() => !cancelled && setError('Could not load your household.'));
    return () => {
      cancelled = true;
    };
  }, [user]);

  // 2. Live subscriptions for the household.
  useEffect(() => {
    setReceipts([]);
    setIncomes([]);
    setSettlements([]);
    setLoaded({ receipts: false, incomes: false, settlements: false });
    if (!householdId) return;
    const subs: Unsubscribe[] = [];
    const fail = () => setError('Lost access to your household data.');
    const base = doc(db, 'households', householdId);

    subs.push(
      onSnapshot(
        base,
        async (snap) => {
          const d = snap.data() ?? {};
          setBudgets((d.budgets?.byCategory as Record<string, number>) ?? {});
          setCustomCategories(Array.isArray(d.customCategories) ? d.customCategories : []);
          const uids: string[] = Array.isArray(d.memberUids) ? d.memberUids : [];
          const people = await Promise.all(
            uids.map(async (uid) => {
              try {
                const u = (await getDoc(doc(db, 'users', uid))).data();
                const email = (u?.email as string | null) ?? null;
                return { uid, name: str(u?.displayName) || email?.split('@')[0] || 'Member', email };
              } catch {
                return { uid, name: 'Member', email: null };
              }
            }),
          );
          setMembers(people);
        },
        fail,
      ),
    );
    subs.push(
      onSnapshot(
        collection(base, 'receipts'),
        (snap) => {
          setReceipts(snap.docs.map((x) => toReceipt(x.id, x.data(), householdId)));
          setLoaded((l) => ({ ...l, receipts: true }));
        },
        fail,
      ),
    );
    subs.push(
      onSnapshot(
        collection(base, 'incomes'),
        (snap) => {
          setIncomes(snap.docs.map((x) => toIncome(x.id, x.data(), householdId)));
          setLoaded((l) => ({ ...l, incomes: true }));
        },
        fail,
      ),
    );
    subs.push(
      onSnapshot(
        collection(base, 'settlements'),
        (snap) => {
          setSettlements(
            snap.docs.map((x) => {
              const d = x.data();
              return {
                id: x.id,
                fromUid: str(d.fromUid),
                toUid: str(d.toUid),
                amountUsd: num(d.amountUsd),
                createdAt: str(d.createdAt),
                householdId,
              };
            }),
          );
          setLoaded((l) => ({ ...l, settlements: true }));
        },
        fail,
      ),
    );
    return () => subs.forEach((u) => u());
  }, [householdId]);

  const value = useMemo<DataValue>(() => {
    const byUid = new Map(members.map((m) => [m.uid, m.name]));
    return {
      ready: Boolean(householdId) && loaded.receipts && loaded.incomes && loaded.settlements,
      error,
      householdId,
      members,
      memberName: (uid) => (uid ? byUid.get(uid) ?? 'Member' : 'Member'),
      budgets,
      customCategories,
      receipts,
      incomes,
      settlements,
      currency,
      setCurrency: (c) => {
        setCurrencyState(c);
        try {
          localStorage.setItem(CURRENCY_KEY, c);
        } catch {
          /* private mode: keep in memory only */
        }
      },
    };
  }, [householdId, loaded, error, members, budgets, customCategories, receipts, incomes, settlements, currency]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData outside DataProvider');
  return v;
}
