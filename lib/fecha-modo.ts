import { getDb } from "./db";

/**
 * Dónde se pide la fecha (24-oct, Blake): «despues» = tras el precio (Tiempo 2): Kira IGNORA el campo de fecha que traiga ManyChat
 * (el contacto conserva el valor de otras veces y «Full Contact Data» lo manda aunque ya no se pregunte). «formulario» = la fecha viene
 * del formulario de ManyChat, como antes. Ajuste `app_settings.fecha_despues_del_precio` (true/false); por defecto, formulario.
 */
const CLAVE = "fecha_despues_del_precio";

export async function leerFechaDespues(): Promise<boolean> {
  try {
    const { data, error } = await getDb().from("app_settings").select("value").eq("key", CLAVE).maybeSingle();
    return !error && (data as { value?: unknown } | null)?.value === true;
  } catch {
    return false;
  }
}

export async function guardarFechaDespues(v: boolean): Promise<void> {
  const { error } = await getDb().from("app_settings").upsert({ key: CLAVE, value: v, updated_at: new Date().toISOString(), updated_by: "telegram" });
  if (error) throw new Error(`No se pudo guardar el ajuste: ${error.message}`);
}

export interface FechaModoPort {
  manejar(chatId: number, argumento: string): Promise<void>;
}

export function crearFlujoFechaModo(deps: {
  leer(): Promise<boolean>;
  guardar(v: boolean): Promise<void>;
  enviar(chatId: number, texto: string): Promise<unknown>;
  logEvent(e: { kind: string; summary: string }): Promise<void>;
}): FechaModoPort {
  const estado = (v: boolean) =>
    v ? "📅 DESPUÉS DEL PRECIO: Kira ignora la fecha que mande ManyChat y se la pide a la clienta tras el precio." : "📋 DEL FORMULARIO: Kira usa la fecha que mande ManyChat (si no hay, se la pide después del precio).";
  return {
    async manejar(chatId, argumento) {
      const a = argumento.trim().toLowerCase();
      if (!a) {
        await deps.enviar(chatId, `${estado(await deps.leer())}\n\n/fecha despues → la fecha se pide tras el precio (ignora la de ManyChat)\n/fecha formulario → usa la del formulario de ManyChat`);
        return;
      }
      const v = /^(despues|después|precio|on)$/.test(a) ? true : /^(formulario|manychat|off)$/.test(a) ? false : null;
      if (v === null) {
        await deps.enviar(chatId, "No te entiendo. Escribe /fecha despues o /fecha formulario.");
        return;
      }
      await deps.guardar(v);
      await deps.logEvent({ kind: "modo_fecha_cambiado", summary: `Fecha: ${v ? "después del precio" : "del formulario"}` });
      await deps.enviar(chatId, `Hecho. ${estado(v)}`);
    },
  };
}
