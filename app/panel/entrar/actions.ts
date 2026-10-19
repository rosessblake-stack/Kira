"use server";

import { redirect } from "next/navigation";
import { logEvent, logSecurity } from "../../../lib/db";
import { redeemLoginToken } from "../../../lib/panel-auth";
import { authStore } from "../../../lib/panel-store";
import { iniciarSesion } from "../../../lib/panel-session";

/** El enlace se gasta aquí (al pulsar el botón), no al abrir la página: las vistas previas no lo consumen. */
export async function entrar(formData: FormData) {
  const token = String(formData.get("t") ?? "").slice(0, 100);
  const session = await redeemLoginToken(authStore, token);
  if (!session) {
    await logSecurity({
      kind: "acceso_panel_denegado",
      source: "panel",
      detail: { reason: "enlace_invalido" },
    });
    redirect("/panel/entrar?error=1");
  }
  await iniciarSesion(session);
  await logEvent("system", { kind: "panel_acceso", summary: "Inicio de sesión en el panel" });
  redirect("/panel/proceso");
}
