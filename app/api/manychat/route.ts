import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { makeFlowDeps, makePhotoDeps } from "../../../lib/composicion";
import { crearClienteReal } from "../../../lib/cliente-real";
import * as db from "../../../lib/db";
import { descargarImagenSegura } from "../../../lib/descarga-segura";
import { crearEntradaManychat } from "../../../lib/manychat-entrada-flow";
import { leerSolicitud } from "../../../lib/manychat-entrada";
import { crearFlujoFotos } from "../../../lib/photo-flow";
import { crearFlujoPropuestas } from "../../../lib/proposal-flow";
import { safeEqual } from "../../../lib/safe-equal";
import * as tg from "../../../lib/telegram";

export const dynamic = "force-dynamic";
// Descargar las fotos, leerlas con Claude y consultar a Legacy tarda; el trabajo sigue después de contestar a ManyChat.
export const maxDuration = 60;

/** Tope de intentos anotados por hora en Seguridad: lo de fuera no puede llenar el registro. */
const MAX_FALLOS_HORA = 20;
const MAX_CUERPO = 100_000;

async function anotarSeguridad(kind: "firma_invalida" | "payload_inesperado", detail?: Record<string, unknown>) {
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

/**
 * Entrada de ManyChat: al terminar el flujo «cita / agendar», un bloque «Solicitud externa» manda aquí todo de una vez
 * (docs/FLUJO_MANYCHAT.md). Se exige la clave compartida MANYCHAT_WEBHOOK_SECRET en la cabecera x-kira-secret. Se contesta enseguida
 * (ManyChat no espera) y el trabajo —fotos, lectura, precio y aviso a Blake— sigue después. MODO SOMBRA: a la clienta no se le escribe.
 */
export async function POST(req: Request) {
  const secreto = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (!secreto) {
    await db.logEvent("system", { kind: "config_incompleta", level: "error", summary: "Falta MANYCHAT_WEBHOOK_SECRET: no se pueden recibir solicitudes de ManyChat" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (!safeEqual(req.headers.get("x-kira-secret"), secreto)) {
    await anotarSeguridad("firma_invalida");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const cuerpo = await req.text();
  if (cuerpo.length > MAX_CUERPO) {
    await anotarSeguridad("payload_inesperado", { reason: "cuerpo_demasiado_grande", bytes: cuerpo.length });
    return NextResponse.json({ ok: false }, { status: 413 });
  }
  let json: unknown;
  try {
    json = JSON.parse(cuerpo);
  } catch {
    await anotarSeguridad("payload_inesperado", { reason: "json_no_valido" });
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const leida = leerSolicitud(json);
  if (!leida.ok) {
    await anotarSeguridad("payload_inesperado", { reason: leida.motivo });
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const s = leida.solicitud;

  // Idempotencia: ManyChat reintenta si tarda. Mismo contacto + mismos datos en la misma hora = la misma solicitud.
  const huella = createHash("sha256").update(cuerpo).digest("hex").slice(0, 32);
  const hora = new Date().toISOString().slice(0, 13);
  try {
    if (!(await db.recordUpdate("manychat", `${s.contactoId}:${huella}:${hora}`))) return NextResponse.json({ ok: true, duplicado: true });
  } catch (e) {
    await db.logEvent("manychat", { kind: "solicitud_fallo", level: "error", summary: e instanceof Error ? e.message : "error desconocido" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const raw = process.env.TELEGRAM_ADMIN_USER_ID?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    await db.logEvent("system", { kind: "config_incompleta", level: "error", summary: "Falta TELEGRAM_ADMIN_USER_ID: no hay a quién avisar de la solicitud" });
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const photos = crearFlujoFotos(makePhotoDeps());
  const entrada = crearEntradaManychat({
    proposals: crearFlujoPropuestas(makeFlowDeps(photos, crearClienteReal())),
    photos,
    descargar: (direccion) => descargarImagenSegura(direccion),
    chatIdAdmin: Number(raw),
    enviar: (chatId, texto) => tg.sendMessage(chatId, texto),
    logEvent: (e) => db.logEvent("manychat", e),
  });
  after(() => entrada.procesar(s));
  return NextResponse.json({ ok: true });
}
