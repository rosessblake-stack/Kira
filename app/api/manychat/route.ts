import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { makeFlowDeps, makePhotoDeps } from "../../../lib/composicion";
import { crearClienteReal } from "../../../lib/cliente-real";
import { DIAS_FOTO_PELO } from "../../../lib/clientas";
import { fotoPeloReciente } from "../../../lib/clientas-store";
import { descargarBytes } from "../../../lib/foto-store";
import * as db from "../../../lib/db";
import { descargarImagenSegura } from "../../../lib/descarga-segura";
import { crearEntradaManychat } from "../../../lib/manychat-entrada-flow";
import { clavesRecibidas, componerMensaje, leerSolicitud } from "../../../lib/manychat-entrada";
import { leerFechaDespues } from "../../../lib/fecha-modo";
import { crearFlujoFotos } from "../../../lib/photo-flow";
import { crearFlujoPropuestas } from "../../../lib/proposal-flow";
import { MAX_CUERPO, anotarSeguridad, comprobarClave } from "../../../lib/manychat-seguridad";
import * as tg from "../../../lib/telegram";

export const dynamic = "force-dynamic";
// Descargar las fotos, leerlas con Claude y consultar a Legacy tarda; el trabajo sigue después de contestar a ManyChat.
export const maxDuration = 60;

/**
 * Entrada de ManyChat: al terminar el flujo «cita / agendar», un bloque «Solicitud externa» manda aquí todo de una vez
 * (docs/FLUJO_MANYCHAT.md). Se exige la clave compartida MANYCHAT_WEBHOOK_SECRET en la cabecera x-kira-secret. Se contesta enseguida
 * (ManyChat no espera) y el trabajo —fotos, lectura, precio y aviso a Blake— sigue después. MODO SOMBRA: a la clienta no se le escribe.
 */
export async function POST(req: Request) {
  const rechazo = await comprobarClave(req);
  if (rechazo) return rechazo;

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
    await anotarSeguridad("payload_inesperado", { reason: leida.motivo, claves: clavesRecibidas(json) });
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  let s = leida.solicitud;
  // Fecha después del precio: se ignora la que traiga ManyChat (el contacto la conserva de otras veces).
  if (s.fechaTexto && (await leerFechaDespues())) {
    const sinFecha = { ...s, fechaTexto: null };
    s = { ...sinFecha, texto: componerMensaje(sinFecha) };
  }

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
    async fotoPeloAnterior(instagram) {
      const f = await fotoPeloReciente(instagram, new Date(Date.now() - DIAS_FOTO_PELO * 86_400_000));
      return f ? descargarBytes({ storage_path: f.storage_path }) : null;
    },
    chatIdAdmin: Number(raw),
    enviar: (chatId, texto) => tg.sendMessage(chatId, texto),
    logEvent: (e) => db.logEvent("manychat", e),
  });
  after(() => entrada.procesar(s));
  return NextResponse.json({ ok: true });
}
