import type { ProposalPort } from "./proposal-flow";
import { safeEqual } from "./safe-equal";

/**
 * Lógica del bot de Telegram, separada de las conexiones reales (base de datos
 * y API de Telegram) para poder probarla con simulaciones.
 *
 * Reglas:
 *  - Sin firma válida del webhook: se rechaza y se registra.
 *  - Mientras no haya administrador configurado, el bot SOLO responde a /start
 *    diciendo el user_id de quien escribe. No hace nada más.
 *  - Con administrador configurado, solo él puede usar el bot. Cualquier otro
 *    intento se descarta y queda en eventos de seguridad.
 *  - Cada aviso de Telegram se procesa una sola vez (idempotencia).
 *  - Cada botón es de un solo uso.
 */

export type Config = {
  webhookSecret: string | undefined;
  adminUserId: number | null;
};

export type SecurityKind =
  | "firma_invalida"
  | "telegram_no_autorizado"
  | "limite_de_peticiones"
  | "payload_inesperado"
  | "acceso_panel_denegado"
  | "posible_inyeccion";

export interface Deps {
  /** Devuelve true si es nuevo, false si ya se había procesado. */
  recordUpdate(provider: string, externalId: string): Promise<boolean>;
  logEvent(e: {
    kind: string;
    level?: "info" | "warn" | "error";
    summary: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
  logSecurity(e: {
    kind: SecurityKind;
    source: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
  hasIssuedTest(nonce: string): Promise<boolean>;
  sendMessage(
    chatId: number,
    text: string,
    replyMarkup?: unknown,
    opts?: { noPreview?: boolean },
  ): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  editMessage(chatId: number, messageId: number, text: string): Promise<void>;
  newNonce(): string;
  /** Emite un enlace de un solo uso para entrar al panel. Nunca debe registrarse. */
  createLoginLink(): Promise<string>;
  /** Propuestas de cita: simulación, botones Aprobar/Editar/Rechazar y edición por texto. */
  proposals: ProposalPort;
}

export type HandlerResult = { status: number; body: Record<string, unknown> };

const OK: HandlerResult = { status: 200, body: { ok: true } };

type TgUser = { id?: number };
type TgChat = { id?: number; type?: string };
type TgMessage = { message_id?: number; from?: TgUser; chat?: TgChat; text?: string };
type TgCallback = { id?: string; from?: TgUser; data?: string; message?: TgMessage };
type TgUpdate = { update_id?: number; message?: TgMessage; callback_query?: TgCallback };

const CALLBACK_RE = /^t:([0-9a-f]{32}):(ok|ed|no)$/;
const PROPOSAL_CB_RE = /^p:([0-9a-f]{32}):(ok|ed|no)$/;

const LABELS: Record<string, string> = {
  ok: "✅ Aprobado",
  ed: "✏️ Editar (todavía no implementado en la prueba)",
  no: "❌ Rechazado",
};

export async function handleTelegramRequest(
  secretHeader: string | null,
  rawBody: string,
  config: Config,
  deps: Deps,
): Promise<HandlerResult> {
  if (!config.webhookSecret) {
    await deps.logEvent({
      kind: "config_incompleta",
      level: "error",
      summary: "Falta TELEGRAM_WEBHOOK_SECRET: se rechazan todos los avisos de Telegram",
    });
    return { status: 500, body: { ok: false } };
  }

  if (!safeEqual(secretHeader, config.webhookSecret)) {
    await deps.logSecurity({ kind: "firma_invalida", source: "telegram" });
    return { status: 401, body: { ok: false } };
  }

  let update: TgUpdate;
  try {
    update = JSON.parse(rawBody) as TgUpdate;
  } catch {
    await deps.logSecurity({
      kind: "payload_inesperado",
      source: "telegram",
      detail: { reason: "json_invalido" },
    });
    return { status: 400, body: { ok: false } };
  }

  if (!update || typeof update.update_id !== "number") {
    await deps.logSecurity({
      kind: "payload_inesperado",
      source: "telegram",
      detail: { reason: "sin_update_id" },
    });
    return { status: 400, body: { ok: false } };
  }

  const isNew = await deps.recordUpdate("telegram", String(update.update_id));
  if (!isNew) return { status: 200, body: { ok: true, duplicate: true } };

  if (update.callback_query) {
    await handleCallback(update.callback_query, config, deps);
    return OK;
  }
  if (update.message) {
    await handleMessage(update.message, config, deps);
    return OK;
  }
  return OK;
}

async function handleMessage(msg: TgMessage, config: Config, deps: Deps) {
  const fromId = msg.from?.id;
  const chatId = msg.chat?.id;
  if (typeof fromId !== "number" || typeof chatId !== "number") return;
  // Solo chats privados con el bot.
  if (msg.chat?.type !== "private") return;

  const text = (msg.text ?? "").trim();
  const cmd = text.split(/[\s@]/)[0].toLowerCase();

  // Modo de configuración: aún no hay administrador.
  if (config.adminUserId === null) {
    if (cmd === "/start") {
      await deps.logEvent({
        kind: "setup_start",
        summary: "Alguien escribió /start mientras no hay administrador configurado",
        detail: { user_id: fromId },
      });
      await deps.sendMessage(
        chatId,
        `Hola. Tu user_id de Telegram es ${fromId}.\n\nDáselo a Claude para activar el bot. Hasta entonces no hará nada más.`,
      );
    }
    return;
  }

  if (fromId !== config.adminUserId) {
    await deps.logSecurity({
      kind: "telegram_no_autorizado",
      source: "telegram",
      detail: { user_id: fromId, via: "mensaje" },
    });
    return;
  }

  if (cmd === "/start") {
    await deps.sendMessage(
      chatId,
      "Kira activa. Te he identificado como administrador.\n\n/simular <mensaje> → simula el mensaje de un cliente y te manda la propuesta\n/panel → enlace para entrar al panel\n/prueba → mensaje de prueba con botones",
    );
    return;
  }

  if (cmd === "/panel") {
    const url = await deps.createLoginLink();
    // El enlace es una credencial: ni el aviso ni el registro llevan jamás el token.
    await deps.logEvent({
      kind: "panel_enlace_emitido",
      summary: "Enlace de acceso al panel enviado al administrador",
    });
    await deps.sendMessage(
      chatId,
      `Enlace para entrar al panel. Vale 5 minutos y solo se puede usar una vez:\n\n${url}\n\nSi no lo has pedido tú, ignóralo.`,
      undefined,
      { noPreview: true },
    );
    return;
  }

  if (cmd === "/prueba") {
    const nonce = deps.newNonce();
    // Primero se registra y después se envía: así el botón siempre encuentra su registro.
    await deps.logEvent({
      kind: "prueba_enviada",
      summary: "Mensaje de prueba con botones enviado al administrador",
      detail: { nonce },
    });
    await deps.sendMessage(
      chatId,
      "Mensaje de prueba de Kira.\n\nAsí te llegarán las propuestas: pulsa un botón.",
      {
        inline_keyboard: [
          [
            { text: "Aprobar", callback_data: `t:${nonce}:ok` },
            { text: "Editar", callback_data: `t:${nonce}:ed` },
            { text: "Rechazar", callback_data: `t:${nonce}:no` },
          ],
        ],
      },
    );
    return;
  }

  if (cmd === "/simular") {
    // Todo lo que sigue al comando es el mensaje del "cliente"; no se interpreta como orden.
    await deps.proposals.simular(chatId, text.replace(/^\S+\s*/, ""));
    return;
  }

  if (cmd === "/cancelar") {
    if (!(await deps.proposals.cancelarEdicion(chatId))) {
      await deps.sendMessage(chatId, "No hay ninguna edición en curso.");
    }
    return;
  }

  // Texto libre: solo se atiende si hay una edición abierta (tras pulsar Editar en una propuesta).
  if (text && !text.startsWith("/") && (await deps.proposals.textoLibre(chatId, text))) return;

  await deps.sendMessage(chatId, "No conozco ese comando. Prueba con /simular, /panel o /prueba.");
}

async function handleCallback(cq: TgCallback, config: Config, deps: Deps) {
  const callbackId = cq.id;
  const fromId = cq.from?.id;
  if (typeof callbackId !== "string" || typeof fromId !== "number") return;

  if (config.adminUserId === null || fromId !== config.adminUserId) {
    await deps.logSecurity({
      kind: "telegram_no_autorizado",
      source: "telegram",
      detail: { user_id: fromId, via: "boton" },
    });
    await deps.answerCallback(callbackId);
    return;
  }

  // Botones de una propuesta de cita (de un solo uso: lo controla el flujo con un nonce atómico).
  const propuesta = PROPOSAL_CB_RE.exec(cq.data ?? "");
  if (propuesta) {
    await deps.proposals.boton({
      callbackId,
      chatId: cq.message?.chat?.id ?? fromId,
      messageId: typeof cq.message?.message_id === "number" ? cq.message.message_id : null,
      fromId,
      nonce: propuesta[1],
      accion: propuesta[2] as "ok" | "ed" | "no",
    });
    return;
  }

  const match = CALLBACK_RE.exec(cq.data ?? "");
  if (!match) {
    await deps.logSecurity({
      kind: "payload_inesperado",
      source: "telegram",
      detail: { reason: "callback_invalido" },
    });
    await deps.answerCallback(callbackId, "Botón no válido");
    return;
  }
  const [, nonce, action] = match;

  if (!(await deps.hasIssuedTest(nonce))) {
    await deps.logSecurity({
      kind: "payload_inesperado",
      source: "telegram",
      detail: { reason: "nonce_desconocido" },
    });
    await deps.answerCallback(callbackId, "Botón no válido");
    return;
  }

  const first = await deps.recordUpdate("telegram_button", nonce);
  if (!first) {
    await deps.answerCallback(callbackId, "Ya procesado");
    return;
  }

  const label = LABELS[action];
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  if (typeof chatId === "number" && typeof messageId === "number") {
    await deps.editMessage(chatId, messageId, `Mensaje de prueba de Kira.\n\n${label}`);
  }
  await deps.answerCallback(callbackId, label);
  await deps.logEvent({
    kind: "prueba_boton",
    summary: `Botón de prueba pulsado: ${label}`,
    detail: { nonce, action },
  });
}
