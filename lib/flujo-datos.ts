import { getDb } from "./db";

/**
 * Flujo de ManyChat que pide «¿cómo te apunto?» y «¿a qué correo te mando la invitación?» (24-oct, Blake). Kira lo lanza por la API de
 * ManyChat al confirmarse el pago. Su identificador (`flow_ns`, no es un secreto) se guarda en `app_settings.flujo_datos_cita_ns`
 * y se cambia con /flowdatos. Sin él, Kira pide el correo por mensaje de texto como antes.
 */
const CLAVE = "flujo_datos_cita_ns";
export const FLOW_NS_RE = /^[A-Za-z0-9_:.-]{5,100}$/;

export async function leerFlujoDatos(): Promise<string | null> {
  try {
    const { data, error } = await getDb().from("app_settings").select("value").eq("key", CLAVE).maybeSingle();
    const v = (data as { value?: unknown } | null)?.value;
    return !error && typeof v === "string" && FLOW_NS_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export async function guardarFlujoDatos(v: string | null): Promise<void> {
  const { error } = await getDb().from("app_settings").upsert({ key: CLAVE, value: v ?? "", updated_at: new Date().toISOString(), updated_by: "telegram" });
  if (error) throw new Error(`No se pudo guardar el ajuste: ${error.message}`);
}

export interface FlujoDatosPort {
  manejar(chatId: number, argumento: string): Promise<void>;
}

export function crearFlujoFlujoDatos(deps: {
  leer(): Promise<string | null>;
  guardar(v: string | null): Promise<void>;
  enviar(chatId: number, texto: string): Promise<unknown>;
  logEvent(e: { kind: string; summary: string }): Promise<void>;
}): FlujoDatosPort {
  return {
    async manejar(chatId, argumento) {
      const a = argumento.trim();
      if (!a) {
        const actual = await deps.leer();
        await deps.enviar(chatId, actual ? `Flujo de nombre y correo: ${actual}\n\n/flowdatos off → apagarlo (Kira pedirá el correo por mensaje)\n/flowdatos <identificador> → cambiarlo` : "No hay flujo de nombre y correo: Kira pide el correo por mensaje de texto.\n\n/flowdatos <identificador> → ponerlo (el identificador que te da ManyChat en ese flujo)");
        return;
      }
      if (/^(off|no|apagar)$/i.test(a)) {
        await deps.guardar(null);
        await deps.logEvent({ kind: "flujo_datos_apagado", summary: "Flujo de nombre y correo apagado" });
        await deps.enviar(chatId, "Hecho. Kira pedirá el correo por mensaje de texto.");
        return;
      }
      if (!FLOW_NS_RE.test(a)) {
        await deps.enviar(chatId, "Ese identificador no tiene buena pinta (solo letras, números y _ : . -). Cópialo otra vez de ManyChat.");
        return;
      }
      await deps.guardar(a);
      await deps.logEvent({ kind: "flujo_datos_cambiado", summary: "Flujo de nombre y correo configurado" });
      await deps.enviar(chatId, "Hecho. Al confirmarse una cita sin correo, Kira lanzará ese flujo para pedir nombre y correo.");
    },
  };
}
