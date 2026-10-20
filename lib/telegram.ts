import { formatoPlegable } from "./telegram-formato";

/**
 * Cliente mínimo de la API de Telegram.
 * Los errores nunca incluyen la URL (contiene el token del bot).
 */

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("Falta TELEGRAM_BOT_TOKEN");
  return t;
}

/**
 * Solo las pruebas de extremo a extremo (KIRA_E2E=1) pueden apuntar a otro servidor. En producción el token
 * del bot nunca puede acabar enviándose a una dirección distinta de la de Telegram por un ajuste suelto.
 */
function apiBase(): string {
  return process.env.KIRA_E2E === "1" && process.env.TELEGRAM_API_BASE ? process.env.TELEGRAM_API_BASE : "https://api.telegram.org";
}

type TgResponse<T> = { ok: boolean; result?: T; description?: string };

export async function tgCall<T = unknown>(
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/bot${token()}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    throw new Error(`Telegram ${method}: sin conexión`);
  }
  let json: TgResponse<T>;
  try {
    json = (await res.json()) as TgResponse<T>;
  } catch {
    throw new Error(`Telegram ${method}: respuesta no válida (${res.status})`);
  }
  if (!json.ok) {
    throw new Error(`Telegram ${method}: ${json.description ?? "error"} (${res.status})`);
  }
  return json.result as T;
}

export async function sendMessage(
  chatId: number,
  text: string,
  replyMarkup?: unknown,
  opts?: { noPreview?: boolean; plegable?: string },
): Promise<number | null> {
  // `plegable` = el resumen de la primera línea; el texto entero va plegado debajo (lib/telegram-formato.ts).
  const html = opts?.plegable ? formatoPlegable(opts.plegable, text) : null;
  const enviado = await tgCall<{ message_id?: number }>("sendMessage", {
    chat_id: chatId,
    text: html ?? text,
    ...(html ? { parse_mode: "HTML" } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    // Sin vista previa: así nada abre el enlace por su cuenta antes que Blake.
    ...(opts?.noPreview ? { link_preview_options: { is_disabled: true } } : {}),
  });
  return typeof enviado?.message_id === "number" ? enviado.message_id : null;
}

export async function answerCallback(callbackId: string, text?: string) {
  await tgCall("answerCallbackQuery", {
    callback_query_id: callbackId,
    ...(text ? { text } : {}),
  });
}

export async function editMessage(chatId: number, messageId: number, text: string) {
  await tgCall("editMessageText", { chat_id: chatId, message_id: messageId, text });
}

// ---------------------------------------------------------------------------
// Archivos: descargar lo que Blake envía y enviarle fotos guardadas
// ---------------------------------------------------------------------------

/** El archivo supera el tope: se avisa a Blake sin descargarlo entero. */
export class ArchivoDemasiadoGrande extends Error {
  constructor() {
    super("El archivo es demasiado grande");
  }
}

/**
 * Descarga un archivo de Telegram por su file_id. Se corta en cuanto pasa del tope (no se fía del tamaño declarado)
 * y los errores nunca llevan la dirección, que contiene el token del bot.
 */
export async function descargarArchivo(fileId: string, maxBytes: number): Promise<Uint8Array> {
  const info = await tgCall<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!info?.file_path || !/^[\w./-]{1,200}$/.test(info.file_path) || info.file_path.includes("..")) {
    throw new Error("Telegram no devolvió una ruta de archivo válida");
  }
  if (typeof info.file_size === "number" && info.file_size > maxBytes) throw new ArchivoDemasiadoGrande();

  let res: Response;
  try {
    res = await fetch(`${apiBase()}/file/bot${token()}/${info.file_path}`, { cache: "no-store" });
  } catch {
    throw new Error("Telegram (descarga): sin conexión");
  }
  if (!res.ok || !res.body) throw new Error(`Telegram (descarga): respuesta ${res.status}`);

  const partes: Uint8Array[] = [];
  let total = 0;
  const lector = res.body.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await lector.cancel();
      throw new ArchivoDemasiadoGrande();
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

export type FotoParaEnviar = { bytes: Uint8Array; mime: string; ext: string; pie: string };

async function tgMultipart(method: string, campos: Record<string, string>, archivos: { campo: string; foto: FotoParaEnviar }[]) {
  const form = new FormData();
  for (const [k, v] of Object.entries(campos)) form.append(k, v);
  for (const { campo, foto } of archivos) {
    form.append(campo, new Blob([foto.bytes as BlobPart], { type: foto.mime }), `${campo}.${foto.ext}`);
  }
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/bot${token()}/${method}`, { method: "POST", body: form, cache: "no-store" });
  } catch {
    throw new Error(`Telegram ${method}: sin conexión`);
  }
  let json: TgResponse<unknown>;
  try {
    json = (await res.json()) as TgResponse<unknown>;
  } catch {
    throw new Error(`Telegram ${method}: respuesta no válida (${res.status})`);
  }
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? "error"} (${res.status})`);
}

const PIE_MAX = 1000; // Telegram admite 1024 caracteres en el pie de una foto

/** Una foto, o un álbum si son varias (Telegram admite de 2 a 10 por álbum). Los pies son texto plano. */
export async function sendPhotos(chatId: number, fotos: FotoParaEnviar[], opts?: { silent?: boolean }): Promise<void> {
  if (fotos.length === 0) return;
  if (fotos.length === 1) {
    await tgMultipart("sendPhoto", { chat_id: String(chatId), caption: fotos[0].pie.slice(0, PIE_MAX), ...(opts?.silent ? { disable_notification: "true" } : {}) }, [{ campo: "photo", foto: fotos[0] }]);
    return;
  }
  const lote = fotos.slice(0, 10);
  const media = lote.map((f, i) => ({ type: "photo", media: `attach://f${i}`, caption: f.pie.slice(0, PIE_MAX) }));
  await tgMultipart(
    "sendMediaGroup",
    { chat_id: String(chatId), media: JSON.stringify(media), ...(opts?.silent ? { disable_notification: "true" } : {}) },
    lote.map((foto, i) => ({ campo: `f${i}`, foto })),
  );
}

export type BotInfo = { username?: string };
export type WebhookInfo = {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
};

export const getMe = () => tgCall<BotInfo>("getMe");
export const getWebhookInfo = () => tgCall<WebhookInfo>("getWebhookInfo");
export const setWebhook = (url: string, secretToken: string) =>
  tgCall<boolean>("setWebhook", {
    url,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
