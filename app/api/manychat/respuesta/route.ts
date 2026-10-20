import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { crearClienteReal } from "../../../../lib/cliente-real";
import { conversacionDeInstagram } from "../../../../lib/cliente-store";
import * as db from "../../../../lib/db";
import { leerRespuesta } from "../../../../lib/manychat-entrada";
import { MAX_CUERPO, anotarSeguridad, comprobarClave } from "../../../../lib/manychat-seguridad";
import * as tg from "../../../../lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lo que la clienta escribe después del flujo («vale», «confirmado»…). ManyChat lo reenvía aquí (docs/FLUJO_RESPUESTAS_KIRA.md) con la
 * misma clave que la solicitud. Kira solo entiende respuestas cortas y exactas (lib/clienta.ts); todo lo demás se lo reenvía a Blake
 * sin contestar. Se contesta 200 enseguida y el trabajo sigue después.
 */
export async function POST(req: Request) {
  const rechazo = await comprobarClave(req);
  if (rechazo) return rechazo;

  const cuerpo = await req.text();
  if (cuerpo.length > MAX_CUERPO) {
    await anotarSeguridad("payload_inesperado", { reason: "cuerpo_demasiado_grande", bytes: cuerpo.length, en: "respuesta" });
    return NextResponse.json({ ok: false }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(cuerpo);
  } catch {
    await anotarSeguridad("payload_inesperado", { reason: "json_no_valido", en: "respuesta" });
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const leida = leerRespuesta(json);
  if (!leida.ok) {
    await anotarSeguridad("payload_inesperado", { reason: leida.motivo, en: "respuesta" });
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const { contactoId, texto } = leida.respuesta;

  // ManyChat reintenta si tarda: mismo contacto + mismo texto en el mismo minuto = el mismo mensaje.
  const huella = createHash("sha256").update(texto).digest("hex").slice(0, 24);
  const minuto = new Date().toISOString().slice(0, 16);
  try {
    if (!(await db.recordUpdate("manychat_respuesta", `${contactoId}:${huella}:${minuto}`))) return NextResponse.json({ ok: true, duplicado: true });
  } catch (e) {
    await db.logEvent("manychat", { kind: "respuesta_fallo", level: "error", summary: e instanceof Error ? e.message : "error desconocido" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const raw = process.env.TELEGRAM_ADMIN_USER_ID?.trim();
  after(async () => {
    try {
      const convId = await conversacionDeInstagram(contactoId);
      if (!convId) {
        await db.logEvent("manychat", { kind: "respuesta_sin_conversacion", level: "warn", summary: "Ha escrito un contacto que no tiene solicitud en Kira: se ignora" });
        return;
      }
      await crearClienteReal().respuestaClienta(convId, texto);
    } catch (e) {
      await db.logEvent("manychat", { kind: "respuesta_fallo", level: "error", summary: e instanceof Error ? e.message : "error desconocido" });
      if (raw && /^\d+$/.test(raw)) await tg.sendMessage(Number(raw), "⚠️ Ha escrito una clienta y no he podido gestionarlo (fallo técnico). Mira Fallos en el panel y contéstale tú.").catch(() => undefined);
    }
  });
  return NextResponse.json({ ok: true });
}
