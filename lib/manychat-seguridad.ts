import { NextResponse } from "next/server";
import * as db from "./db";
import { safeEqual } from "./safe-equal";

/** Lo común a las entradas de ManyChat: la clave compartida y el tope de intentos anotados en Seguridad. */

/** Tope de intentos anotados por hora en Seguridad: lo de fuera no puede llenar el registro. */
const MAX_FALLOS_HORA = 20;
export const MAX_CUERPO = 100_000;

export async function anotarSeguridad(kind: "firma_invalida" | "payload_inesperado", detail?: Record<string, unknown>) {
  try {
    const { count } = await db
      .getDb()
      .from("security_events")
      .select("id", { count: "exact", head: true })
      .eq("source", "manychat")
      .gte("at", new Date(Date.now() - 3_600_000).toISOString());
    if ((count ?? 0) < MAX_FALLOS_HORA) await db.logSecurity({ kind, source: "manychat", detail });
  } catch {
    /* el registro es de mejor esfuerzo */
  }
}

/** null = autorizada. Si no, la respuesta que hay que devolver (500 sin clave configurada, 401 con clave mala). */
export async function comprobarClave(req: Request): Promise<NextResponse | null> {
  const secreto = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (!secreto) {
    await db.logEvent("system", { kind: "config_incompleta", level: "error", summary: "Falta MANYCHAT_WEBHOOK_SECRET: no se pueden recibir mensajes de ManyChat" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (!safeEqual(req.headers.get("x-kira-secret"), secreto)) {
    await anotarSeguridad("firma_invalida");
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return null;
}
