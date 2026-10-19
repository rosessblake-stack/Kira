/**
 * Cliente mínimo de la API de Telegram.
 * Los errores nunca incluyen la URL (contiene el token del bot).
 */

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("Falta TELEGRAM_BOT_TOKEN");
  return t;
}

type TgResponse<T> = { ok: boolean; result?: T; description?: string };

export async function tgCall<T = unknown>(
  method: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
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

export async function sendMessage(chatId: number, text: string, replyMarkup?: unknown) {
  await tgCall("sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
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
