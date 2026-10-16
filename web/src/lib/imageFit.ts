/** Downscale only. Small photos stay 1:1 so we never invent pixels. */
export function fitImageScale(width: number, height: number, maxSide = 1600): number {
  const longest = Math.max(width, height);
  if (!(longest > 0) || !(maxSide > 0)) return 1;
  return Math.min(1, maxSide / longest);
}
