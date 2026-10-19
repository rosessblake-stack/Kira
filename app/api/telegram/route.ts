import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { handleTelegramRequest, type Config, type Deps } from "../../../lib/telegram-handler";
import { clasificarConClaude } from "../../../lib/claude";
import { leerBasico } from "../../../lib/lectura-basica";
import * as db from "../../../lib/db";
import { issueLoginToken } from "../../../lib/panel-auth";
import { authStore } from "../../../lib/panel-store";
import { consultarLegacy } from "../../../lib/pricing";
import { crearFlujoPropuestas, type FlowDeps } from "../../../lib/proposal-flow";
import * as store from "../../../lib/proposal-store";
import { isPaused } from "../../../lib/settings";
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

function makeFlowDeps(): FlowDeps {
  return {
    now: () => new Date(),
    newNonce: () => randomUUID().replace(/-/g, ""),
    clasificar: clasificarConClaude,
    // Solo /simular usa este flujo: sin clave de Claude se puede probar todo con la lectura básica.
    lecturaBasica: (texto, ahora) => ({ tipo: "ok", raw: leerBasico(texto, ahora), entrada: 0, salida: 0 }),
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
    logEvent: ({ source, ...e }) => db.logEvent(source, e),
    logSecurity: db.logSecurity,
    enviar: tg.sendMessage,
    editar: tg.editMessage,
    responderCallback: tg.answerCallback,
  };
}

function makeDeps(host: string | null): Deps {
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
    proposals: crearFlujoPropuestas(makeFlowDeps()),
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
