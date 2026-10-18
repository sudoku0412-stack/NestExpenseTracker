import {
  buildUserPrompt,
  resetParseRateLimitForTests,
  shouldRateLimit as parseShouldRateLimit,
  stripAiJsonFence,
} from '../scripts/parse-receipt-worker';
import {
  pickCategory,
  sanitizeClassifyBody,
  VALID_CATEGORIES,
} from '../scripts/classify-worker';
import {
  resetSmsRateLimitForTests,
  shouldRateLimit as smsShouldRateLimit,
  validateSmsInvite,
} from '../scripts/sms-invite-worker';

describe('parse-receipt worker prompt + JSON cleanup', () => {
  it('truncates OCR at 8000 characters so a huge scan cannot blow the prompt', () => {
    const raw = 'X'.repeat(9000);
    const prompt = buildUserPrompt(raw, undefined);
    expect(prompt).toContain('X'.repeat(8000));
    expect(prompt).not.toContain('X'.repeat(8001));
  });

  it('keeps at most two user-corrected examples and drops empty item lists', () => {
    const prompt = buildUserPrompt('STORE\nTOTAL 5.00', [
      { rawOcr: 'first', items: [] },
      { rawOcr: 'second', items: [{ name: 'Milk', amount: 3.5, category: 'Groceries' }] },
      { rawOcr: 'third', items: [{ name: 'Bread', amount: 2, category: 'Groceries' }] },
      { rawOcr: 'fourth', items: [{ name: 'Eggs', amount: 4, category: 'Groceries' }] },
    ]);
    expect(prompt).not.toContain('USER-CORRECTED EXAMPLE 3');
    expect(prompt).toContain('USER-CORRECTED EXAMPLE 1');
    expect(prompt).toContain('USER-CORRECTED EXAMPLE 2');
    expect(prompt).toContain('Milk');
    expect(prompt).toContain('Bread');
    expect(prompt).not.toContain('Eggs');
    expect(prompt).not.toContain('first');
  });

  it('strips markdown fences so a fenced model reply still parses', () => {
    expect(JSON.parse(stripAiJsonFence('```json\n{"store":"Costco","total":12}\n```'))).toEqual({
      store: 'Costco',
      total: 12,
    });
    expect(JSON.parse(stripAiJsonFence('```\n{"ok":true}\n```'))).toEqual({ ok: true });
    expect(JSON.parse(stripAiJsonFence('{"bare":1}'))).toEqual({ bare: 1 });
  });
});

describe('parse-receipt worker rate limit', () => {
  const t0 = 1_700_000_000_000;

  beforeEach(() => {
    resetParseRateLimitForTests();
  });

  it('allows 10 requests in a window and 429s the 11th for that IP only', () => {
    for (let i = 0; i < 10; i++) {
      expect(parseShouldRateLimit('1.1.1.1', t0 + i)).toBe(false);
    }
    expect(parseShouldRateLimit('1.1.1.1', t0 + 10)).toBe(true);
    expect(parseShouldRateLimit('9.9.9.9', t0 + 10)).toBe(false);
  });

  it('resets the window after 60s', () => {
    for (let i = 0; i < 10; i++) expect(parseShouldRateLimit('1.1.1.1', t0)).toBe(false);
    expect(parseShouldRateLimit('1.1.1.1', t0 + 59_999)).toBe(true);
    expect(parseShouldRateLimit('1.1.1.1', t0 + 60_001)).toBe(false);
  });
});

describe('classify worker sanitizer + category pick', () => {
  it('requires a non-blank name and caps it at 200 characters', () => {
    expect(sanitizeClassifyBody({ name: '   ' })).toEqual({ ok: false, error: 'name required' });
    const long = 'A'.repeat(250);
    const out = sanitizeClassifyBody({ name: `  ${long}  ` });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.name).toHaveLength(200);
  });

  it('drops unknown category hints so the model cannot be steered off the allow-list', () => {
    const out = sanitizeClassifyBody({ name: 'Milk', categories: ['Groceries', 'Pets', 'Dining'] });
    expect(out).toEqual({ ok: true, name: 'Milk', categories: ['Groceries', 'Dining'] });
  });

  it('falls back to the full standard list when categories is omitted', () => {
    const out = sanitizeClassifyBody({ name: 'Milk' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.categories).toEqual([...VALID_CATEGORIES]);
  });

  it('matches a category word case-insensitively and otherwise returns Other', () => {
    expect(pickCategory('Groceries', ['Groceries', 'Dining'])).toBe('Groceries');
    expect(pickCategory('Looks like dining to me!!', ['Groceries', 'Dining'])).toBe('Dining');
    expect(pickCategory('no idea', ['Groceries', 'Dining'])).toBe('Other');
  });
});

describe('sms-invite worker validation + rate limit', () => {
  const t0 = 1_700_000_000_000;

  beforeEach(() => {
    resetSmsRateLimitForTests();
  });

  it('requires E.164, a non-empty body, and a 320-char cap', () => {
    expect(validateSmsInvite('5551234', 'hi')).toEqual({ ok: false, error: 'to must be E.164' });
    expect(validateSmsInvite('+15551234', '   ')).toEqual({ ok: false, error: 'text required' });
    expect(validateSmsInvite('+15551234', 'x'.repeat(321))).toEqual({
      ok: false,
      error: 'text too long',
    });
    expect(validateSmsInvite('  +15551234  ', '  join nest  ')).toEqual({
      ok: true,
      to: '+15551234',
      text: 'join nest',
    });
  });

  it('allows 5 SMS sends per IP per minute then blocks', () => {
    for (let i = 0; i < 5; i++) expect(smsShouldRateLimit('2.2.2.2', t0)).toBe(false);
    expect(smsShouldRateLimit('2.2.2.2', t0 + 1)).toBe(true);
    expect(smsShouldRateLimit('3.3.3.3', t0 + 1)).toBe(false);
  });
});
