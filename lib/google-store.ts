import { getDb } from "./db";
import { cifrar, descifrar, secretoDeCifrado } from "./google-oauth";

/**
 * Dónde se guarda la conexión con Google (tabla app_settings, solo servidor):
 *   google_calendar     { refresh (CIFRADO), email, calendario, conectado_en }
 *   google_oauth_state  { hash, expira }     el «state» de una conexión a medias (de un solo uso)
 * El refresh token nunca sale de aquí sin descifrar a propósito, y nunca se registra.
 */

const CLAVE_CONEXION = "google_calendar";
const CLAVE_STATE = "google_oauth_state";

export type ConexionGuardada = {
  refreshToken: string;
  email: string | null;
  /** Calendario donde van las citas ("primary" = el principal de la cuenta conectada). */
  calendario: string;
  conectadoEn: string | null;
};

function ok(what: string, error: { message: string } | null) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** null = sin conectar (o la conexión guardada ya no se puede leer: hay que volver a conectar). */
export async function leerConexion(): Promise<ConexionGuardada | null> {
  const { data, error } = await getDb().from("app_settings").select("value").eq("key", CLAVE_CONEXION).maybeSingle();
  ok("No se pudo leer la conexión con Google", error);
  const v = (data as { value?: Record<string, unknown> } | null)?.value;
  if (!v || typeof v.refresh !== "string") return null;
  const refreshToken = descifrar(v.refresh, secretoDeCifrado());
  if (!refreshToken) return null;
  return {
    refreshToken,
    email: typeof v.email === "string" ? v.email : null,
    calendario: typeof v.calendario === "string" && v.calendario ? v.calendario : "primary",
    conectadoEn: typeof v.conectado_en === "string" ? v.conectado_en : null,
  };
}

export async function guardarConexion(c: { refreshToken: string; email: string | null; calendario: string }, ahora: Date): Promise<void> {
  const { error } = await getDb().from("app_settings").upsert({
    key: CLAVE_CONEXION,
    value: { refresh: cifrar(c.refreshToken, secretoDeCifrado()), email: c.email, calendario: c.calendario, conectado_en: ahora.toISOString() },
    updated_at: ahora.toISOString(),
    updated_by: "panel",
  });
  ok("No se pudo guardar la conexión con Google", error);
}

export async function borrarConexion(): Promise<void> {
  const { error } = await getDb().from("app_settings").delete().eq("key", CLAVE_CONEXION);
  ok("No se pudo quitar la conexión con Google", error);
}

export async function guardarState(hash: string, expiraIso: string, ahora: Date): Promise<void> {
  const { error } = await getDb().from("app_settings").upsert({ key: CLAVE_STATE, value: { hash, expira: expiraIso }, updated_at: ahora.toISOString(), updated_by: "panel" });
  ok("No se pudo preparar la conexión con Google", error);
}

/**
 * Gasta el «state» de forma atómica: el borrado decide quién gana. Devuelve true solo si coincide, no ha caducado y es la
 * primera vez que se usa. Si dos retornos llegan a la vez, solo uno recibe true.
 */
export async function gastarState(hash: string, ahora: Date): Promise<boolean> {
  const db = getDb();
  const { data, error } = await db.from("app_settings").select("value").eq("key", CLAVE_STATE).maybeSingle();
  ok("No se pudo comprobar la conexión con Google", error);
  const v = (data as { value?: { hash?: unknown; expira?: unknown } } | null)?.value;
  if (!v || v.hash !== hash || typeof v.expira !== "string" || Date.parse(v.expira) < ahora.getTime()) return false;
  const r = await db.from("app_settings").delete().eq("key", CLAVE_STATE).select("key");
  ok("No se pudo cerrar la conexión con Google", r.error);
  return (r.data?.length ?? 0) === 1;
}
