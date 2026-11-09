/** Older receipts stored the literal "self" for the signed-in user. Web
 *  editors rewrite it to the real uid so balances stay correct on other devices. */
export function remapSelfId(id: string, uid: string | undefined): string {
  return id === 'self' && uid ? uid : id;
}

export function remapSelfIds(ids: string[] | undefined, uid: string | undefined): string[] {
  return (ids ?? []).map((id) => remapSelfId(id, uid));
}

export function remapSelfRecord<T>(values: Record<string, T> | undefined, uid: string | undefined): Record<string, T> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([k, v]) => [remapSelfId(k, uid), v]));
}
