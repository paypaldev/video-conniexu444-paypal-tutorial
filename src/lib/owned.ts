// ---------------------------------------------------------------------
//  What the student owns, including grants the last my_sets() call
//  has not echoed yet (webhook granted, RPC still returning the old list).
// ---------------------------------------------------------------------

/** True for create-order's 409 when the entitlement is already in place. */
export function alreadyOwnsSet(message: string): boolean {
  return /already own this set/i.test(message);
}

/**
 * Union of the server list and optimistic grants. Replacing owned with
 * my_sets() alone flips a just-bought card back to $3 until refresh.
 */
export function mergeOwned(
  fromServer: Iterable<string>,
  optimistic: Iterable<string>
): Set<string> {
  const next = new Set(fromServer);
  for (const id of optimistic) next.add(id);
  return next;
}
