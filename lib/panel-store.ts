import { getDb } from "./db";
import type { AuthStore } from "./panel-auth";

function check(what: string, error: { message: string } | null) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Almacén real del acceso al panel, sobre Supabase (solo servidor). */
export const authStore: AuthStore = {
  async revokeOpenLoginTokens(nowIso) {
    const { error } = await getDb()
      .from("panel_login_tokens")
      .update({ used_at: nowIso })
      .is("used_at", null);
    check("No se pudieron anular los enlaces anteriores", error);
  },

  async insertLoginToken(hash, expiresAtIso) {
    const { error } = await getDb()
      .from("panel_login_tokens")
      .insert({ token_hash: hash, expires_at: expiresAtIso });
    check("No se pudo guardar el enlace de acceso", error);
  },

  async consumeLoginToken(hash, nowIso) {
    // Un solo UPDATE con las condiciones dentro: dos canjes a la vez no pueden ganar los dos.
    const { data, error } = await getDb()
      .from("panel_login_tokens")
      .update({ used_at: nowIso })
      .eq("token_hash", hash)
      .is("used_at", null)
      .gt("expires_at", nowIso)
      .select("id");
    check("No se pudo canjear el enlace de acceso", error);
    return (data?.length ?? 0) === 1;
  },

  async insertSession(hash, expiresAtIso) {
    const { error } = await getDb()
      .from("panel_sessions")
      .insert({ token_hash: hash, expires_at: expiresAtIso });
    check("No se pudo crear la sesión", error);
  },

  async isSessionActive(hash, nowIso) {
    const { data, error } = await getDb()
      .from("panel_sessions")
      .select("id")
      .eq("token_hash", hash)
      .is("revoked_at", null)
      .gt("expires_at", nowIso)
      .limit(1);
    check("No se pudo comprobar la sesión", error);
    return (data?.length ?? 0) > 0;
  },

  async revokeSession(hash, nowIso) {
    const { error } = await getDb()
      .from("panel_sessions")
      .update({ revoked_at: nowIso })
      .eq("token_hash", hash)
      .is("revoked_at", null);
    check("No se pudo cerrar la sesión", error);
  },
};
