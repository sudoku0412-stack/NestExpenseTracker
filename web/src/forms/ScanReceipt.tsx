import { useRef, useState } from 'react';
import { convertEntryToUsd } from '@app/lib/currency';
import type { Receipt } from '@app/types';
import { Modal } from '../components';
import { useAuth } from '../auth';
import { useData } from '../data';
import { API_BASE } from '../premium';

/** Shrinks a photo so the upload stays small and fast; receipts stay legible at 1600px. */
async function toJpegDataUrl(file: File, maxSide = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

const CATEGORIES = new Set(['Groceries', 'Electronics', 'Dining', 'Pharmacy', 'Gas', 'Clothing', 'Entertainment', 'Travel', 'Healthcare', 'Electricity', 'Other']);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Reads a receipt photo with AI and hands the result back as a draft to review before saving. */
export default function ScanReceipt({ onClose, onDraft }: { onClose: () => void; onDraft: (d: Partial<Receipt>) => void }) {
  const { user } = useAuth();
  const { currency } = useData();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState('');

  async function pick(file: File) {
    if (!user) return;
    setErr('');
    setBusy(true);
    try {
      const image = await toJpegDataUrl(file);
      setPreview(image);
      const res = await fetch(`${API_BASE}/v1/parse-receipt`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      });
      if (res.status === 402) throw new Error('AI receipt scanning is a Premium feature.');
      if (!res.ok) throw new Error(res.status === 422 ? "Couldn't read that receipt. Try a clearer, flatter photo." : 'Scanning is unavailable right now. Try again shortly.');
      const r = ((await res.json()) as { receipt: Record<string, unknown> }).receipt;
      const category = typeof r.category === 'string' && CATEGORIES.has(r.category) ? r.category : 'Other';
      const usd = (n: unknown) => { const v = numOrNull(n); return v === null ? undefined : convertEntryToUsd(v, currency); };
      const items = Array.isArray(r.lineItems) ? (r.lineItems as { name?: unknown; amount?: unknown }[]) : [];
      onDraft({
        storeName: typeof r.storeName === 'string' ? r.storeName : '',
        date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10) : undefined,
        totalAmount: usd(r.totalAmount) ?? 0,
        taxAmount: usd(r.taxAmount),
        category,
        categoryTags: [category],
        originalCurrency: currency,
        lineItems: items.filter((i) => typeof i.name === 'string' && numOrNull(i.amount) !== null).map((i) => ({ id: crypto.randomUUID(), name: i.name as string, amount: convertEntryToUsd(i.amount as number, currency), category })),
      });
    } catch (e) {
      setErr((e as Error).message || 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <Modal title="Scan a receipt" onClose={onClose}>
      <p className="sub">Upload a photo of a receipt. AI reads it and you review everything before it is saved. Amounts are read as {currency}.</p>
      {preview && <img src={preview} alt="Receipt preview" style={{ maxHeight: 260, objectFit: 'contain', borderRadius: 12 }} />}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); }} />
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn primary big" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Reading receipt…' : preview ? 'Choose a different photo' : 'Choose photo'}</button>
    </Modal>
  );
}
