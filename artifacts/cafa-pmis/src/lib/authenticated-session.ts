export interface AuthenticatedSessionSnapshot {
  userId: number | null;
  generation: number;
}

let activeUserId: number | null = null;
let generation = 0;

/**
 * Establish the browser authority only from a successful current-identity
 * response. The generation changes when a previous authority was invalidated,
 * even if the same user signs back in.
 */
export function establishAuthenticatedSession(userId: number): AuthenticatedSessionSnapshot {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("Cannot establish an invalid authenticated user");
  }
  if (activeUserId !== userId) generation += 1;
  activeUserId = userId;
  return getAuthenticatedSessionSnapshot();
}

/** Fence every asynchronous operation captured under the former authority. */
export function invalidateAuthenticatedSession(): AuthenticatedSessionSnapshot {
  generation += 1;
  activeUserId = null;
  return getAuthenticatedSessionSnapshot();
}

export function getAuthenticatedSessionSnapshot(): AuthenticatedSessionSnapshot {
  return { userId: activeUserId, generation };
}

export function isAuthenticatedSessionCurrent(
  snapshot: AuthenticatedSessionSnapshot,
): boolean {
  return snapshot.userId !== null
    && snapshot.userId === activeUserId
    && snapshot.generation === generation;
}
