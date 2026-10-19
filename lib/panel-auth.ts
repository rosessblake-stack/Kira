import { createHash, randomBytes } from "node:crypto";

/**
 * Acceso al panel sin contraseñas: el bot de Telegram (que solo obedece al
 * administrador) emite un enlace de un solo uso; al canjearlo nace una sesión.
 *
 * Esta parte es lógica pura sobre un almacén inyectado, para probarla sin
 * base de datos. Los tokens nunca llegan al almacén en claro: solo su hash.
 */

export const LOGIN_TOKEN_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 12 * 3_600_000;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const newToken = (): string => randomBytes(32).toString("base64url");
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export interface AuthStore {
  /** Anula los enlaces aún sin usar: solo vale el último que se emita. */
  revokeOpenLoginTokens(nowIso: string): Promise<void>;
  insertLoginToken(hash: string, expiresAtIso: string): Promise<void>;
  /** Atómico: true solo si estaba vigente y sin usar, y lo deja usado. */
  consumeLoginToken(hash: string, nowIso: string): Promise<boolean>;
  insertSession(hash: string, expiresAtIso: string): Promise<void>;
  isSessionActive(hash: string, nowIso: string): Promise<boolean>;
  revokeSession(hash: string, nowIso: string): Promise<void>;
}

/** Emite un enlace de acceso nuevo y devuelve el token (solo existe en claro aquí). */
export async function issueLoginToken(store: AuthStore, now = new Date()): Promise<string> {
  const token = newToken();
  await store.revokeOpenLoginTokens(now.toISOString());
  await store.insertLoginToken(
    hashToken(token),
    new Date(now.getTime() + LOGIN_TOKEN_TTL_MS).toISOString(),
  );
  return token;
}

export type Session = { token: string; expires: Date };

/** Canjea un enlace por una sesión. Devuelve null si no es válido, está usado o caducó. */
export async function redeemLoginToken(
  store: AuthStore,
  token: string,
  now = new Date(),
): Promise<Session | null> {
  if (!TOKEN_RE.test(token)) return null;
  if (!(await store.consumeLoginToken(hashToken(token), now.toISOString()))) return null;

  const session = newToken();
  const expires = new Date(now.getTime() + SESSION_TTL_MS);
  await store.insertSession(hashToken(session), expires.toISOString());
  return { token: session, expires };
}

export async function isValidSession(
  store: AuthStore,
  token: string | undefined,
  now = new Date(),
): Promise<boolean> {
  if (!token || !TOKEN_RE.test(token)) return false;
  return store.isSessionActive(hashToken(token), now.toISOString());
}

export async function endSession(
  store: AuthStore,
  token: string | undefined,
  now = new Date(),
): Promise<void> {
  if (!token || !TOKEN_RE.test(token)) return;
  await store.revokeSession(hashToken(token), now.toISOString());
}
