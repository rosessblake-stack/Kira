import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { handleTelegramRequest, type Config, type Deps } from "../../../lib/telegram-handler";
import { leerEstancias, guardarEstancias } from "../../../lib/estancias-store";
import { crearAgendaGoogle } from "../../../lib/google-agenda";
import { textoEstadoCalendario } from "../../../lib/google-estado";
import { configGoogle } from "../../../lib/google-oauth";
import { makeFlowDeps, makePhotoDeps } from "../../../lib/composicion";
import { crearFlujoFotos } from "../../../lib/photo-flow";
import { crearFlujoPropuestas } from "../../../lib/proposal-flow";
import * as db from "../../../lib/db";
import { issueLoginToken } from "../../../lib/panel-auth";
import { authStore } from "../../../lib/panel-store";
import { crearClienteReal } from "../../../lib/cliente-real";
import { claveManychat, crearClienteManychat } from "../../../lib/manychat";
import { crearFlujoManychat } from "../../../lib/manychat-flow";
import { crearFlujoRegistro } from "../../../lib/registro-flow";
import * as registroStore from "../../../lib/registro-store";
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
