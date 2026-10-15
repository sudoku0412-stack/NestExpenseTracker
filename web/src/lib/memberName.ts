/** Household member label from the users/{uid} doc. */
export function nameFromUserDoc(displayName: unknown, email: string | null | undefined): string {
  const name = typeof displayName === 'string' ? displayName : '';
  return name || email?.split('@')[0] || 'Member';
}

/** Receipt/income "added by" / "earned by" lookup. Missing uid is still "Member". */
export function lookupMemberName(byUid: Map<string, string>, uid: string | undefined | null): string {
  return uid ? byUid.get(uid) ?? 'Member' : 'Member';
}
