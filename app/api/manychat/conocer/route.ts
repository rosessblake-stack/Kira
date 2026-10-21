import { NextResponse } from "next/server";
import { crearFlujoClientas, NO_CONOCIDA } from "../../../../lib/clientas";
import { makeClientasDeps } from "../../../../lib/composicion";
import * as db from "../../../../lib/db";
import { leerConsultaClienta } from "../../../../lib/manychat-entrada";
import { MAX_CUERPO, anotarSeguridad, comprobarClave } from "../../../../lib/manychat-seguridad";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * «¿Conoces a esta clienta?» (docs/FLUJO_CLIENTAS_QUE_VUELVEN.md): ManyChat lo llama al empezar el flujo con el usuario de Instagram.
 * Si Kira la tiene en su ficha, devuelve SOLO datos básicos (nombre, email, ciudad, nº de citas, último servicio y si hay foto del pelo
 * reciente) para que ManyChat se salte esas preguntas. Siempre responde 200 con el mismo formato (cualquier fallo = «no la conozco»):
 * el flujo de ManyChat nunca debe romperse por esto. Misma clave que el resto de entradas.
 */
export async function POST(req: Request) {
  const rechazo = await comprobarClave(req);
  if (rechazo) return rechazo;
  try {
    const cuerpo = await req.text();
    if (cuerpo.length > MAX_CUERPO) {
      await anotarSeguridad("payload_inesperado", { reason: "cuerpo_demasiado_grande", bytes: cuerpo.length, en: "conocer" });
      return NextResponse.json({ ok: true, ...NO_CONOCIDA });
    }
    let json: unknown = null;
    try {
      json = JSON.parse(cuerpo);
    } catch {
      await anotarSeguridad("payload_inesperado", { reason: "json_no_valido", en: "conocer" });
      return NextResponse.json({ ok: true, ...NO_CONOCIDA });
    }
    const { instagram } = leerConsultaClienta(json);
    if (!instagram) return NextResponse.json({ ok: true, ...NO_CONOCIDA });
    const r = await crearFlujoClientas(makeClientasDeps()).conocer(instagram);
    return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    await db.logEvent("manychat", { kind: "conocer_fallo", level: "warn", summary: e instanceof Error ? e.message : "error desconocido" }).catch(() => undefined);
    return NextResponse.json({ ok: true, ...NO_CONOCIDA });
  }
}
