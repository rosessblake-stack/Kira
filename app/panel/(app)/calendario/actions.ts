"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logEvent } from "../../../../lib/db";
import { crearAgendaGoogle } from "../../../../lib/google-agenda";
import { revocarPermiso } from "../../../../lib/google-oauth";
import { borrarConexion, leerConexion } from "../../../../lib/google-store";
import { requireAdmin } from "../../../../lib/panel-session";

/** Quita la conexión: Google deja de valer (mejor esfuerzo) y Kira olvida el permiso guardado. */
export async function desconectar() {
  await requireAdmin();
  const con = await leerConexion().catch(() => null);
  const revocado = con ? await revocarPermiso(con.refreshToken) : false;
  await borrarConexion();
  await logEvent("calendar", { kind: "google_desconectado", summary: "Google Calendar desconectado desde el panel", detail: { revocado_en_google: revocado } });
  revalidatePath("/panel/calendario");
  redirect("/panel/calendario?c=desconectado");
}

/**
 * Prueba de verdad que Kira puede leer la agenda: cuenta los eventos de los últimos 30 y los próximos 60 días. Si no hay NINGUNO,
 * lo avisa: lo más probable es que se haya conectado la cuenta equivocada (con el calendario vacío, todo hueco saldría libre).
 */
export async function comprobar() {
  await requireAdmin();
  let destino = "/panel/calendario?c=error";
  try {
    const ahora = Date.now();
    const eventos = await crearAgendaGoogle().eventosEntre(new Date(ahora - 30 * 86_400_000), new Date(ahora + 60 * 86_400_000));
    const n = eventos.filter((e) => !e.esPrueba).length;
    destino = n === 0 ? "/panel/calendario?c=vacio" : `/panel/calendario?c=ok&n=${n}`;
  } catch (e) {
    await logEvent("calendar", { kind: "agenda_comprobacion_fallo", level: "error", summary: e instanceof Error ? e.message : "error desconocido" });
  }
  redirect(destino);
}
