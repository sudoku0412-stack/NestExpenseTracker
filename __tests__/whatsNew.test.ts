import { decideWhatsNew, WHATS_NEW } from '../lib/whatsNew';

jest.mock('expo-constants', () => ({ expoConfig: { version: '2.0.0' } }));

describe('decideWhatsNew', () => {
  it('shows an unseen version that has notes (existing user upgrading: nothing stored)', () => {
    expect(decideWhatsNew(null, '2.0.0')).toBe('show');
    expect(decideWhatsNew('1.0.9', '2.0.0')).toBe('show');
  });
  it('never repeats a seen version', () => {
    expect(decideWhatsNew('2.0.0', '2.0.0')).toBe('none');
  });
  it('quietly marks a version with no notes', () => {
    expect(decideWhatsNew('2.0.0', '2.0.1')).toBe('mark');
  });
  it('does nothing when the version is unknown', () => {
    expect(decideWhatsNew(null, '')).toBe('none');
  });
  it('current release has slides', () => {
    expect(WHATS_NEW['2.0.0'].length).toBeGreaterThan(0);
  });
});
