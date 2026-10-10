/** Older mobile receipts stored the signed-in user as the literal id `self`.
 *  Web must remap that to the current uid before editing or writing values,
 *  or a save would persist `self` and break balances for everyone else. */
export function remapSelfId(id: string, uid: string | undefined): string {
  return id === 'self' ? uid ?? id : id;
}

export function remapSelfIds(ids: string[], uid: string | undefined): string[] {
  return ids.map((id) => remapSelfId(id, uid));
}

export function remapSelfValues<T>(values: Record<string, T>, uid: string | undefined): Record<string, T> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [remapSelfId(k, uid), v]));
}
