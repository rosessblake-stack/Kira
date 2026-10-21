import { getDb } from "./db";
import type { ResultadoEnvio } from "./cliente-flow";
import { ManychatError, type ClienteManychat } from "./manychat";

/**
 * «Kira contesta a las clientas por Instagram». Es un interruptor de Blake (`/responder on|off`), apagado por defecto: apagado, todo
 * sigue en MODO SOMBRA (Kira prepara y te avisa; tú le escribes). Falla hacia el silencio: si no se puede leer el ajuste, está apagado.
 * Lo que se envía son solo las plantillas de lib/clienta.ts (precio, Bizum, confirmación) tras el Aprobar de Blake.
 */

const CLAVE = "kira_responde";

export async function leerResponde(): Promise<boolean> {
  try {
    const { data, error } = await getDb().from("app_settings").select("value").eq("key", CLAVE).maybeSingle();
    return !error && (data as { value?: unknown } | null)?.value === true;
  } catch {
    return false;
  }
}

export async function guardarResponde(activo: boolean): Promise<void> {
  const { error } = await getDb().from("app_settings").upsert({ key: CLAVE, value: activo, updated_at: new Date().toISOString(), updated_by: "telegram" });
  if (error) throw new Error(`No se pudo guardar el ajuste: ${error.message}`);
}

/** El envío por Instagram de la conversación con la clienta (lo que usa `canalEnviar`). */
export function crearEnvioInstagram(deps: { activo(): Promise<boolean>; cliente(): ClienteManychat | null }) {
  return async (contactoId: string, texto: string): Promise<ResultadoEnvio> => {
    // Apagado (o sin clave de ManyChat): modo sombra, no se escribe a nadie y Blake recibe el aviso.
    if (!(await deps.activo())) return { ok: false, motivo: "canal_no_conectado" };
    const cli = deps.cliente();
    if (!cli) return { ok: false, motivo: "canal_no_conectado" };
    try {
      await cli.enviarTexto(contactoId, texto);
      // Kira espera su respuesta: se pone la etiqueta que recoge la «Respuesta predeterminada» (mejor esfuerzo; el flujo también puede ponerla).
      await cli.ponerEtiqueta(contactoId, "esperando_kira").catch(() => undefined);
      return { ok: true };
    } catch (e) {
      return { ok: false, motivo: e instanceof ManychatError ? e.message : "No se pudo enviar el mensaje por ManyChat" };
    }
  };
}

// ---------------------------------------------------------------------------
// /responder
// ---------------------------------------------------------------------------

export interface ResponderDeps {
  leer(): Promise<boolean>;
  guardar(activo: boolean): Promise<void>;
  /** ¿Está puesta la clave de ManyChat? */
  hayClave(): boolean;
  enviar(chatId: number, texto: string): Promise<unknown>;
  logEvent(e: { kind: string; level?: "info" | "warn" | "error"; summary: string }): Promise<void>;
}

export interface ResponderPort {
  manejar(chatId: number, argumento: string): Promise<void>;
}

const ESTADO = (on: boolean) =>
  on
    ? "✅ ACTIVADO: al pulsar Aprobar, Kira le escribe a la clienta por Instagram (precio, Bizum y confirmación). Tú sigues decidiendo con tus botones."
    : "🕶️ MODO SOMBRA: Kira prepara todo y te avisa, pero NO escribe a las clientas. Le contestas tú.";

export function crearFlujoResponder(deps: ResponderDeps): ResponderPort {
  return {
    async manejar(chatId, argumento) {
      const a = argumento.trim().toLowerCase();
      if (!a) {
        await deps.enviar(chatId, `${ESTADO(await deps.leer())}\n\nPara cambiarlo: /responder on  ·  /responder off`);
        return;
      }
      if (a !== "on" && a !== "off") {
        await deps.enviar(chatId, "Escribe /responder on para que Kira conteste a las clientas, /responder off para volver al modo sombra, o /responder para ver cómo está.");
        return;
      }
      if (a === "on" && !deps.hayClave()) {
        await deps.enviar(chatId, "No puedo activarlo: falta la clave de ManyChat (MANYCHAT_API_KEY) en Vercel.");
        return;
      }
      try {
        await deps.guardar(a === "on");
      } catch {
        await deps.logEvent({ kind: "responder_fallo", level: "error", summary: "No se pudo guardar el ajuste de /responder" });
        await deps.enviar(chatId, "No he podido guardar el cambio (fallo técnico). Sigue como estaba.");
        return;
      }
      await deps.logEvent({ kind: a === "on" ? "responder_activado" : "responder_desactivado", summary: a === "on" ? "Blake activó que Kira conteste a las clientas" : "Blake volvió al modo sombra" });
      await deps.enviar(chatId, ESTADO(a === "on"));
    },
  };
}
