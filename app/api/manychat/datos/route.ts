import { after, NextResponse } from "next/server";
import { crearClienteReal } from "../../../../lib/cliente-real";
import { conversacionDeInstagram } from "../../../../lib/cliente-store";
import * as db from "../../../../lib/db";
import { leerDatosCita } from "../../../../lib/manychat-entrada";
import { MAX_CUERPO, anotarSeguridad, comprobarClave } from "../../../../lib/manychat-seguridad";
import * as tg from "../../../../lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Nombre y correo de la clienta tras confirmar su cita (flujo de ManyChat «¿cómo te apunto y a qué correo?», lanzado por Kira).
 * Cuerpo: {"id": contacto, "nombre": …, "email": …}. Misma clave que el resto de entradas. Kira guarda los datos, pone el nombre al
 * evento, invita a la clienta y avisa a Blake. Se contesta 200 enseguida y el trabajo sigue después.
 */
export async function POST(req: Request) {
  const rechazo = await comprobarClave(req);
  if (rechazo) return rechazo;
  const cuerpo = await req.text();
  if (cuerpo.length > MAX_CUERPO) {
    await anotarSeguridad("payload_inesperado", { reason: "cuerpo_demasiado_grande", bytes: cuerpo.length, en: "datos" });
    return NextResponse.json({ ok: false }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(cuerpo);
  } catch {
    await anotarSeguridad("payload_inesperado", { reason: "json_no_valido", en: "datos" });
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const leida = leerDatosCita(json);
  if (!leida.ok) {
    await db.logEvent("manychat", { kind: "datos_cita_no_validos", level: "warn", summary: `El flujo de nombre y correo mandó algo que no vale (${leida.motivo})` }).catch(() => undefined);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const { contactoId, nombre, email } = leida;
  await db.logEvent("manychat", { kind: "datos_cita_recibidos", summary: "Ha llegado el nombre y el correo de una clienta desde ManyChat" }).catch(() => undefined);
  const raw = process.env.TELEGRAM_ADMIN_USER_ID?.trim();
  after(async () => {
    try {
      const convId = await conversacionDeInstagram(contactoId);
      const hecho = convId ? await crearClienteReal().datosDeCita(convId, { nombre, email }) : false;
      if (!hecho) {
        await db.logEvent("manychat", { kind: "datos_cita_sin_cita", level: "warn", summary: "Llegaron nombre y correo pero no hay una cita pagada sin correo a la que ponerlos" });
        if (raw && /^\d+$/.test(raw)) await tg.sendMessage(Number(raw), `📧 Una clienta ha mandado su correo (${email}) pero no encuentro una cita confirmada sin correo. Mírala tú.`).catch(() => undefined);
      }
    } catch (e) {
      await db.logEvent("manychat", { kind: "datos_cita_fallo", level: "error", summary: e instanceof Error ? e.message : "error desconocido" });
      if (raw && /^\d+$/.test(raw)) await tg.sendMessage(Number(raw), "⚠️ Una clienta ha mandado su correo y no he podido guardarlo (fallo técnico). Mira Fallos en el panel y añádelo tú al evento.").catch(() => undefined);
    }
  });
  return NextResponse.json({ ok: true });
}
