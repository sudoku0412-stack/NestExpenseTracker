import { describe, expect, it } from 'vitest';
import { fitImageScale } from '../imageFit';

describe('fitImageScale', () => {
  it('does not upscale a photo already inside the cap', () => {
    expect(fitImageScale(800, 600)).toBe(1);
    expect(fitImageScale(1600, 900)).toBe(1);
  });

  it('scales by the longer side so a 3200x1800 receipt becomes 1600x900', () => {
    expect(fitImageScale(3200, 1800)).toBe(0.5);
    expect(fitImageScale(1800, 3200)).toBe(0.5);
  });

  it('returns 1 for zero or invalid dimensions instead of NaN/Infinity', () => {
    expect(fitImageScale(0, 100)).toBe(1);
    expect(fitImageScale(100, 0)).toBe(1);
    expect(fitImageScale(100, 100, 0)).toBe(1);
  });
});
