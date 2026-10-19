"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logEvent } from "../../../lib/db";
import { cerrarSesionActual, requireAdmin } from "../../../lib/panel-session";
import { setPaused } from "../../../lib/settings";

export async function cerrarSesion() {
  await cerrarSesionActual();
  redirect("/panel/entrar");
}

/** Recibe el estado deseado (no "alternar"): pulsar dos veces nunca lo deja al revés. */
export async function cambiarPausa(formData: FormData) {
  await requireAdmin();
  const pausar = formData.get("pausar") === "1";
  await setPaused(pausar, "panel");
  await logEvent("system", {
    kind: pausar ? "kira_pausada" : "kira_reanudada",
    summary: pausar ? "Kira pausada desde el panel" : "Kira reanudada desde el panel",
  });
  revalidatePath("/panel", "layout");
}
