import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { handleTelegramRequest, type Config, type Deps } from "../../../lib/telegram-handler";
import { clasificarConClaude } from "../../../lib/claude";
import { leerEstancias, guardarEstancias } from "../../../lib/estancias-store";
import { crearAgendaGoogle } from "../../../lib/google-agenda";
import { textoEstadoCalendario } from "../../../lib/google-estado";
import { configGoogle } from "../../../lib/google-oauth";
import * as fotoStore from "../../../lib/foto-store";
import { crearFlujoFotos, resumenDeFotos, type PhotoDeps, type PhotoPort } from "../../../lib/photo-flow";
import { leerBasico } from "../../../lib/lectura-basica";
import * as db from "../../../lib/db";
import { issueLoginToken } from "../../../lib/panel-auth";
import { authStore } from "../../../lib/panel-store";
import { consultarLegacy } from "../../../lib/pricing";
import { crearClienteReal } from "../../../lib/cliente-real";
import { claveManychat, crearClienteManychat } from "../../../lib/manychat";
import { crearFlujoManychat } from "../../../lib/manychat-flow";
import { crearFlujoPropuestas, type FlowDeps } from "../../../lib/proposal-flow";
import * as store from "../../../lib/proposal-store";
import { crearFlujoRegistro } from "../../../lib/registro-flow";
import * as registroStore from "../../../lib/registro-store";
import { isPaused } from "../../../lib/settings";
import { crearFlujoViajes } from "../../../lib/trip-flow";
import * as tg from "../../../lib/telegram";

export const dynamic = "force-dynamic";
// Clasificar con Claude y consultar a Legacy tarda unos segundos: margen amplio para que no se corte a medias.
export const maxDuration = 60;

function readConfig(): Config {
  const raw = process.env.TELEGRAM_ADMIN_USER_ID?.trim();
  return {
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    adminUserId: raw && /^\d+$/.test(raw) ? Number(raw) : null,
  };
}

function makePhotoDeps(): PhotoDeps {
  return {
    now: () => new Date(),
    newId: () => randomUUID(),
    conversacionReciente: fotoStore.conversacionDePruebaReciente,
    primerMensaje: fotoStore.primerMensajeDe,
    fotosDe: fotoStore.listarFotos,
    async descargar(fileId, maxBytes) {
      try {
        return { ok: true, bytes: await tg.descargarArchivo(fileId, maxBytes) };
      } catch (e) {
        if (e instanceof tg.ArchivoDemasiadoGrande) return { ok: false, motivo: "grande" };
        return { ok: false, motivo: "error", detalle: e instanceof Error ? e.message : "error desconocido" };
      }
    },
    guardar: fotoStore.guardarFoto,
    actualizarFicha: fotoStore.actualizarFicha,
    leerBytes: fotoStore.descargarBytes,
    purgarCaducadas: fotoStore.purgarCaducadas,
    enviar: tg.sendMessage,
    enviarFotos: tg.sendPhotos,
    logEvent: ({ source, ...e }) => db.logEvent(source, e),
    logSecurity: db.logSecurity,
  };
}

function makeFlowDeps(photos: PhotoPort, cliente: ReturnType<typeof crearClienteReal>): FlowDeps {
  return {
    cliente,
    agenda: crearAgendaGoogle(),
    now: () => new Date(),
    newNonce: () => randomUUID().replace(/-/g, ""),
    clasificar: clasificarConClaude,
    // Solo /simular usa este flujo: sin clave de Claude se puede probar todo con la lectura básica.
    lecturaBasica: (texto, ahora, zona) => ({ tipo: "ok", raw: leerBasico(texto, ahora, zona), entrada: 0, salida: 0 }),
    perfil: store.perfilGuardado,
    precio: (peticion) => consultarLegacy(peticion),
    estaPausada: isPaused,
    contarLlamadasClaudeHoy: store.contarLlamadasClaudeHoy,
    crearConversacion: store.crearConversacion,
    guardarMensaje: store.guardarMensaje,
    actualizarConversacion: store.actualizarConversacion,
    crearReserva: store.crearReserva,
    actualizarReserva: store.actualizarReserva,
    leerReserva: store.leerReserva,
    marcarMensajeSospechoso: store.marcarMensajeSospechoso,
    verReservaPorNonce: store.verReservaPorNonce,
    tomarNonce: store.tomarNonce,
    reservaEnEdicion: store.reservaEnEdicion,
    estancias: leerEstancias,
    fotosDe: async (conversationId) => resumenDeFotos(await fotoStore.listarFotos(conversationId)),
    describirFoto: (conversationId, tipo, texto) => fotoStore.describirUltima(conversationId, tipo, texto, new Date()),
    enviarFotos: (chatId, conversationId) => photos.reenviar(chatId, conversationId, { silencioso: true }),
    guardarRegistro: registroStore.guardarRegistro,
    retirarRegistro: registroStore.retirarRegistro,
    listarPendientes: store.listarPendientes,
    logEvent: ({ source, ...e }) => db.logEvent(source, e),
    logSecurity: db.logSecurity,
    enviar: tg.sendMessage,
    editar: tg.editMessage,
    responderCallback: tg.answerCallback,
  };
}

function makeDeps(host: string | null): Deps {
  const photos = crearFlujoFotos(makePhotoDeps());
  const client = crearClienteReal();
  return {
    recordUpdate: db.recordUpdate,
    logEvent: (e) => db.logEvent("telegram", e),
    logSecurity: db.logSecurity,
    hasIssuedTest: db.hasIssuedTest,
    sendMessage: async (chatId, text, markup, opts) => {
      await tg.sendMessage(chatId, text, markup, opts);
    },
    answerCallback: tg.answerCallback,
    editMessage: tg.editMessage,
    newNonce: () => randomUUID().replace(/-/g, ""),
    async createLoginLink() {
      if (!host) throw new Error("No se conoce la dirección del panel");
      const token = await issueLoginToken(authStore);
      return `https://${host}/panel/entrar?t=${token}`;
    },
    proposals: crearFlujoPropuestas(makeFlowDeps(photos, client)),
    client,
    manychat: crearFlujoManychat({
      cliente: () => {
        const clave = claveManychat();
        return clave ? crearClienteManychat(clave) : null;
      },
      enviar: tg.sendMessage,
      logEvent: (e) => db.logEvent("manychat", e),
    }),
    async calendarioEstado() {
      const configurado = configGoogle() !== null;
      try {
        const st = configurado ? await crearAgendaGoogle().estado() : { conectado: false, cuenta: null };
        return textoEstadoCalendario({ configurado, ...st });
      } catch {
        return "📅 No he podido leer el estado del calendario ahora mismo. Prueba otra vez en un momento.";
      }
    },
    photos,
    records: crearFlujoRegistro({
      now: () => new Date(),
      listar: registroStore.listarRegistros,
      leerPorSeq: registroStore.leerRegistroPorSeq,
      anotar: registroStore.anotarReal,
      conDatosReales: registroStore.registrosConDatosReales,
      enviar: tg.sendMessage,
      logEvent: (e) => db.logEvent("telegram", e),
    }),
    trips: crearFlujoViajes({
      now: () => new Date(),
      leer: leerEstancias,
      guardar: guardarEstancias,
      enviar: tg.sendMessage,
      logEvent: (e) => db.logEvent("telegram", e),
    }),
  };
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  // Misma dirección que usa /api/setup para registrar el webhook.
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? req.headers.get("host");
  try {
    const result = await handleTelegramRequest(
      req.headers.get("x-telegram-bot-api-secret-token"),
      rawBody,
      readConfig(),
      makeDeps(host),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    // Se responde 200 para que Telegram no reintente en bucle; el fallo queda registrado.
    await db.logEvent("telegram", {
      kind: "error_interno",
      level: "error",
      summary: err instanceof Error ? err.message : "Error desconocido",
    });
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
