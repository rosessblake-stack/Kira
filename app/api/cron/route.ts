import { NextResponse } from "next/server";
import { crearClienteReal } from "../../../lib/cliente-real";
import { recordarPendientes } from "../../../lib/recordatorios";
import * as db from "../../../lib/db";
import { safeEqual } from "../../../lib/safe-equal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Tope de intentos fallidos anotados por hora: lo de fuera no puede llenar el registro de seguridad. */
const MAX_FALLOS_HORA = 20;

/**
 * El temporizador: cada minuto, la base de datos (pg_cron + pg_net de Supabase) llama aquí con la clave compartida CRON_SECRET.
 * Cierra los plazos vencidos de la conversación con la clienta (20 h sin responder al precio, 45 min sin confirmar el Bizum).
 * Sin la clave correcta no hace nada. Es idempotente: llamarlo de más no cambia nada.
 */
export async function POST(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    await db.logEvent("system", { kind: "config_incompleta", level: "error", summary: "Falta CRON_SECRET: el temporizador no puede funcionar" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  const recibido = req.headers.get("x-cron-secret");
  if (!safeEqual(recibido, secreto)) {
    try {
      const { count } = await db
        .getDb()
        .from("security_events")
        .select("id", { count: "exact", head: true })
        .eq("source", "cron")
        .gte("at", new Date(Date.now() - 3_600_000).toISOString());
      if ((count ?? 0) < MAX_FALLOS_HORA) await db.logSecurity({ kind: "firma_invalida", source: "cron" });
    } catch {
      /* el registro es de mejor esfuerzo */
    }
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const { cerradas } = await crearClienteReal().procesarVencidas();
    // Recordatorio de propuestas sin decidir: mejor esfuerzo, nunca estropea el cierre de plazos.
    const recordadas = await recordarPendientes().catch(async (e) => {
      await db.logEvent("system", { kind: "recordatorio_fallo", level: "warn", summary: e instanceof Error ? e.message : "error" }).catch(() => undefined);
      return 0;
    });
    return NextResponse.json({ ok: true, cerradas, recordadas });
  } catch (err) {
    await db.logEvent("system", { kind: "cron_fallo", level: "error", summary: err instanceof Error ? err.message : "error desconocido" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
