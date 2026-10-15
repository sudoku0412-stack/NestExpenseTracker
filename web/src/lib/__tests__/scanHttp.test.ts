import { describe, expect, it } from 'vitest';
import { scanFailureMessage } from '../scanHttp';

describe('scanFailureMessage', () => {
  it('separates paywall, unreadable photo, and generic outage', () => {
    expect(scanFailureMessage(402)).toBe('AI receipt scanning is a Premium feature.');
    expect(scanFailureMessage(422)).toBe("Couldn't read that receipt. Try a clearer, flatter photo.");
    expect(scanFailureMessage(503)).toBe('Scanning is unavailable right now. Try again shortly.');
    expect(scanFailureMessage(401)).toBe('Scanning is unavailable right now. Try again shortly.');
  });
});
