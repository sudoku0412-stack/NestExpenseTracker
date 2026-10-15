/** User-facing error when /v1/parse-receipt does not return 200. */
export function scanFailureMessage(status: number): string {
  if (status === 402) return 'AI receipt scanning is a Premium feature.';
  if (status === 422) return "Couldn't read that receipt. Try a clearer, flatter photo.";
  return 'Scanning is unavailable right now. Try again shortly.';
}
