import { convertEntryToUsd, type CurrencyCode } from '@app/lib/currency';

export type InvestmentDialogKind = 'new' | 'edit' | 'deposit' | 'withdraw' | 'value';

export type InvestmentDraftResult =
  | { ok: false; error: string }
  | {
      ok: true;
      name: string;
      notes: string;
      contributedUsd: number;
      valueUsd: number;
      deltaUsd: number;
    };

/**
 * Investment modal: new/edit need a name; deposit/withdraw need amount > 0;
 * a value update may be 0 (mark the account empty) but not negative/NaN.
 * Empty contributed/value on *new* is stored as 0, matching the form's `Number(x) || 0`.
 */
export function parseInvestmentDialog(
  kind: InvestmentDialogKind,
  fields: { name: string; amountText: string; contributedText: string; notes: string; currency: CurrencyCode },
): InvestmentDraftResult {
  const name = fields.name.trim();
  const notes = fields.notes;
  if (kind === 'new' || kind === 'edit') {
    if (!name) return { ok: false, error: 'Give the account a name.' };
    return {
      ok: true,
      name,
      notes,
      contributedUsd: convertEntryToUsd(Number(fields.contributedText) || 0, fields.currency),
      valueUsd: convertEntryToUsd(Number(fields.amountText) || 0, fields.currency),
      deltaUsd: 0,
    };
  }
  const n = Number(fields.amountText);
  if (!(n > 0) && !(kind === 'value' && n === 0)) {
    return { ok: false, error: 'Enter an amount greater than zero.' };
  }
  const usd = convertEntryToUsd(n, fields.currency);
  return {
    ok: true,
    name,
    notes,
    contributedUsd: 0,
    valueUsd: usd,
    deltaUsd: kind === 'withdraw' ? -usd : kind === 'deposit' ? usd : 0,
  };
}
