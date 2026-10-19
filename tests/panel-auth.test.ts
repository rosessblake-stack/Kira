import { describe, expect, it } from "vitest";
import {
  LOGIN_TOKEN_TTL_MS,
  SESSION_TTL_MS,
  endSession,
  hashToken,
  isValidSession,
  issueLoginToken,
  redeemLoginToken,
  type AuthStore,
} from "../lib/panel-auth";

/** Almacén en memoria que imita las garantías del real (canje atómico, solo hashes). */
function memoryStore() {
  const logins = new Map<string, { expires: number; used: boolean }>();
  const sessions = new Map<string, { expires: number; revoked: boolean }>();
  const calls = { consume: 0 };
  const store: AuthStore = {
    async revokeOpenLoginTokens() {
      for (const t of logins.values()) t.used = true;
    },
    async insertLoginToken(hash, exp) {
      logins.set(hash, { expires: Date.parse(exp), used: false });
    },
    async consumeLoginToken(hash, now) {
      calls.consume++;
      const t = logins.get(hash);
      if (!t || t.used || t.expires <= Date.parse(now)) return false;
      t.used = true;
      return true;
    },
    async insertSession(hash, exp) {
      sessions.set(hash, { expires: Date.parse(exp), revoked: false });
    },
    async isSessionActive(hash, now) {
      const s = sessions.get(hash);
      return !!s && !s.revoked && s.expires > Date.parse(now);
    },
    async revokeSession(hash) {
      const s = sessions.get(hash);
      if (s) s.revoked = true;
    },
  };
  return { store, logins, sessions, calls };
}

const T0 = new Date("2026-10-19T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("enlace de acceso al panel", () => {
  it("se canjea una vez y crea una sesión válida", async () => {
    const { store } = memoryStore();
    const token = await issueLoginToken(store, T0);
    const session = await redeemLoginToken(store, token, at(1000));
    expect(session).not.toBeNull();
    expect(await isValidSession(store, session!.token, at(2000))).toBe(true);
  });

  it("no se puede usar dos veces", async () => {
    const { store } = memoryStore();
    const token = await issueLoginToken(store, T0);
    expect(await redeemLoginToken(store, token, at(1000))).not.toBeNull();
    expect(await redeemLoginToken(store, token, at(2000))).toBeNull();
  });

  it("caduca a los 5 minutos", async () => {
    const { store } = memoryStore();
    const token = await issueLoginToken(store, T0);
    expect(await redeemLoginToken(store, token, at(LOGIN_TOKEN_TTL_MS))).toBeNull();
  });

  it("solo vale el último enlace emitido", async () => {
    const { store } = memoryStore();
    const viejo = await issueLoginToken(store, T0);
    const nuevo = await issueLoginToken(store, at(1000));
    expect(await redeemLoginToken(store, viejo, at(2000))).toBeNull();
    expect(await redeemLoginToken(store, nuevo, at(2000))).not.toBeNull();
  });

  it("descarta sin consultar la base de datos lo que no tiene forma de token", async () => {
    const { store, calls } = memoryStore();
    for (const basura of ["", "abc", "x".repeat(42), "x".repeat(44), "a b".padEnd(43, "a"), "'; drop table--"]) {
      expect(await redeemLoginToken(store, basura, T0)).toBeNull();
    }
    expect(calls.consume).toBe(0);
  });

  it("un token inventado con buena forma no entra", async () => {
    const { store } = memoryStore();
    await issueLoginToken(store, T0);
    expect(await redeemLoginToken(store, "A".repeat(43), at(1000))).toBeNull();
  });

  it("al almacén solo llegan hashes, nunca el token en claro", async () => {
    const { store, logins, sessions } = memoryStore();
    const token = await issueLoginToken(store, T0);
    const session = await redeemLoginToken(store, token, at(1000));
    const guardado = [...logins.keys(), ...sessions.keys()];
    expect(guardado).toContain(hashToken(token));
    expect(guardado).toContain(hashToken(session!.token));
    expect(guardado).not.toContain(token);
    expect(guardado).not.toContain(session!.token);
  });

  it("emite tokens distintos cada vez", async () => {
    const { store } = memoryStore();
    const a = await issueLoginToken(store, T0);
    const b = await issueLoginToken(store, T0);
    expect(a).not.toBe(b);
  });
});

describe("sesión del panel", () => {
  it("caduca a las 12 horas", async () => {
    const { store } = memoryStore();
    const session = await redeemLoginToken(store, await issueLoginToken(store, T0), T0);
    expect(await isValidSession(store, session!.token, at(SESSION_TTL_MS - 1))).toBe(true);
    expect(await isValidSession(store, session!.token, at(SESSION_TTL_MS))).toBe(false);
  });

  it("al cerrar sesión deja de valer", async () => {
    const { store } = memoryStore();
    const session = await redeemLoginToken(store, await issueLoginToken(store, T0), T0);
    await endSession(store, session!.token, at(1000));
    expect(await isValidSession(store, session!.token, at(2000))).toBe(false);
  });

  it("sin cookie o con una cookie falsa no hay sesión", async () => {
    const { store } = memoryStore();
    expect(await isValidSession(store, undefined, T0)).toBe(false);
    expect(await isValidSession(store, "", T0)).toBe(false);
    expect(await isValidSession(store, "A".repeat(43), T0)).toBe(false);
  });

  it("el enlace de acceso no sirve como cookie de sesión", async () => {
    const { store } = memoryStore();
    const token = await issueLoginToken(store, T0);
    expect(await isValidSession(store, token, at(1000))).toBe(false);
  });
});
