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

/** Prueba de verdad que Kira puede leer la agenda: cuenta los eventos de los próximos 7 días. */
export async function comprobar() {
  await requireAdmin();
  let destino = "/panel/calendario?c=error";
  try {
    const ahora = Date.now();
    const eventos = await crearAgendaGoogle().eventosEntre(new Date(ahora), new Date(ahora + 7 * 86_400_000));
    destino = `/panel/calendario?c=ok&n=${eventos.filter((e) => !e.esPrueba).length}`;
  } catch (e) {
    await logEvent("calendar", { kind: "agenda_comprobacion_fallo", level: "error", summary: e instanceof Error ? e.message : "error desconocido" });
  }
  redirect(destino);
}
