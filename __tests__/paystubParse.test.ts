import { parsePaystubText } from '../lib/paystubParse';

describe('parsePaystubText', () => {
  it('reads net pay, pay date, and employer', () => {
    const text = [
      'Acme Corp',
      '123 Main Street',
      'Earnings statement',
      'Pay date: 03/15/2026',
      'Gross pay $4,000.00',
      'Net pay $3,210.55',
    ].join('\n');
    const parsed = parsePaystubText(text);
    expect(parsed.amount).toBeCloseTo(3210.55);
    expect(parsed.date).toBe('2026-03-15');
    expect(parsed.sourceName).toBe('Acme Corp');
    expect(parsed.category).toBe('Salary');
    expect(parsed.confidence).toBe('high');
    expect(parsed.notes).toMatch(/Gross 4000.00/);
  });

  it('falls back to gross when net is missing', () => {
    const parsed = parsePaystubText('Employer: Northwind\nGross earnings 1800.00\nPeriod ending 2026-01-31');
    expect(parsed.amount).toBeCloseTo(1800);
    expect(parsed.date).toBe('2026-01-31');
    expect(parsed.sourceName).toBe('Northwind');
    expect(parsed.confidence).toBe('low');
  });

  it('returns low confidence when almost nothing is readable', () => {
    const parsed = parsePaystubText('blurry photo');
    expect(parsed.amount).toBeNull();
    expect(parsed.confidence).toBe('low');
  });

  it('treats take-home pay as net even when the amount is on the next line', () => {
    const parsed = parsePaystubText(
      ['Northwind Ltd', 'Take-home pay', '$2,150.00', 'Pay date', '15/03/2026'].join('\n'),
    );
    expect(parsed.amount).toBeCloseTo(2150);
    expect(parsed.date).toBe('2026-03-15');
    expect(parsed.sourceName).toBe('Northwind Ltd');
    expect(parsed.confidence).toBe('high');
  });

  it('uses D/M when the first slash-date part is > 12', () => {
    const parsed = parsePaystubText('Net pay $900.00\nPay date 23/03/26');
    expect(parsed.date).toBe('2026-03-23');
  });

  it('parses a named-month payday', () => {
    const parsed = parsePaystubText('Net deposit $1,000.00\nPayday March 2, 2026');
    expect(parsed.date).toBe('2026-03-02');
    expect(parsed.amount).toBeCloseTo(1000);
  });

  it('skips street-address / EIN junk when picking the employer', () => {
    const parsed = parsePaystubText(
      [
        '400 Market Street',
        'Suite 12',
        'EIN 12-3456789',
        'Employer: Contoso Health',
        'Net pay $500.00',
        'Pay date 2026-04-01',
      ].join('\n'),
    );
    expect(parsed.sourceName).toBe('Contoso Health');
  });

  it('ignores a $0.00 money token so a later net line can win', () => {
    const parsed = parsePaystubText('Net pay $0.00\nNet pay $1,250.50\nPay date 2026-02-01');
    expect(parsed.amount).toBeCloseTo(1250.5);
  });

  it('maps 2-digit years: 70+ is 1900s, below that is 2000s', () => {
    expect(parsePaystubText('Net pay $100.00\nPay date 03/15/70').date).toBe('1970-03-15');
    expect(parsePaystubText('Net pay $100.00\nPay date 03/15/00').date).toBe('2000-03-15');
  });

  it('skips a Pay stub / earnings-statement header when picking the employer', () => {
    const parsed = parsePaystubText(
      ['Pay stub', 'Earnings statement', 'Contoso Payroll', 'Net pay $800.00', 'Pay date 2026-05-01'].join(
        '\n',
      ),
    );
    expect(parsed.sourceName).toBe('Contoso Payroll');
  });

  it('accepts cheque date as a payday label', () => {
    const parsed = parsePaystubText('Net pay $400.00\nCheque date 2026-06-15');
    expect(parsed.date).toBe('2026-06-15');
    expect(parsed.confidence).toBe('high');
  });
});

