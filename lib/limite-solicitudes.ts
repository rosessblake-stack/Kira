import { getDb } from "./db";

/**
 * Tope de solicitudes de cita por clienta y día (petición de Blake, 21-oct): evita que alguien «pete» Instagram/Claude pidiendo
 * citas sin parar. Se guarda en app_settings (`limite_solicitudes_dia`): un número, o 0 = sin límite (para probar).
 * Por defecto, 3. Cuenta los formularios de Instagram recibidos de esa conversación en las últimas 24 h.
 */
const CLAVE = "limite_solicitudes_dia";
export const LIMITE_POR_DEFECTO = 3;

export async function leerLimiteDia(): Promise<number> {
  try {
    const { data, error } = await getDb().from("app_settings").select("value").eq("key", CLAVE).maybeSingle();
    const v = (data as { value?: unknown } | null)?.value;
    if (error || typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 1000) return LIMITE_POR_DEFECTO;
    return v;
  } catch {
    return LIMITE_POR_DEFECTO;
  }
}

export async function guardarLimiteDia(n: number): Promise<void> {
  const { error } = await getDb().from("app_settings").upsert({ key: CLAVE, value: n, updated_at: new Date().toISOString(), updated_by: "telegram" });
  if (error) throw new Error(`No se pudo guardar el límite: ${error.message}`);
}

/** Formularios de Instagram de esta conversación en las últimas 24 h (incluido el que acaba de llegar). */
export async function contarSolicitudesDia(conversationId: string): Promise<number> {
  const { count, error } = await getDb()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("direction", "in")
    .like("body", "Solicitud de cita recibida%")
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface LimitePort {
  manejar(chatId: number, argumento: string): Promise<void>;
}

export function crearFlujoLimite(deps: {
  leer(): Promise<number>;
  guardar(n: number): Promise<void>;
  enviar(chatId: number, texto: string): Promise<unknown>;
  logEvent(e: { kind: string; summary: string }): Promise<void>;
}): LimitePort {
  const estado = (n: number) => (n === 0 ? "SIN LÍMITE (modo prueba)" : `${n} solicitud${n === 1 ? "" : "es"} por clienta y día`);
  return {
    async manejar(chatId, argumento) {
      const a = argumento.trim().toLowerCase();
      if (!a) {
        await deps.enviar(chatId, `Límite actual: ${estado(await deps.leer())}.\n\n/limite 3 → máximo 3 solicitudes por clienta al día\n/limite off → sin límite (para probar)`);
        return;
      }
      const n = a === "off" || a === "no" || a === "0" ? 0 : /^\d{1,3}$/.test(a) ? Number(a) : null;
      if (n === null) {
        await deps.enviar(chatId, "No te entiendo. Escribe /limite 3 (máximo al día) o /limite off (sin límite).");
        return;
      }
      await deps.guardar(n);
      await deps.logEvent({ kind: "limite_solicitudes_cambiado", summary: `Límite de solicitudes por clienta y día: ${n === 0 ? "sin límite" : n}` });
      await deps.enviar(chatId, `Hecho: ${estado(n)}.${n === 0 ? "\n\nAcuérdate de volver a poner /limite 3 cuando termines de probar." : ""}`);
    },
  };
}
