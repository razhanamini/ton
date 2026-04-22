interface Session {
  step?: string;
  data?: Record<string, unknown>;
}

const sessions = new Map<number, Session>();

export function getSession(userId: number): Session {
  if (!sessions.has(userId)) sessions.set(userId, {});
  return sessions.get(userId)!;
}

export function setSession(userId: number, session: Session) {
  sessions.set(userId, session);
}

export function clearSession(userId: number) {
  sessions.delete(userId);
}