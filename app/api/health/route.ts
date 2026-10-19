import { NextResponse } from "next/server";
import { comprobarClaude } from "../../../lib/claude-check";
import { getDb } from "../../../lib/db";
import { getMe, getWebhookInfo } from "../../../lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Comprobación de estado. No expone datos ni secretos: solo si cada pieza responde.
 * La lectura de event_log demuestra que la clave de Supabase es la de servidor:
 * las claves anon/publishable no tienen permiso sobre esa tabla.
 */
export async function GET() {
  const env = {
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    TELEGRAM_BOT_TOKEN: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    TELEGRAM_WEBHOOK_SECRET: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
    TELEGRAM_ADMIN_USER_ID: Boolean(process.env.TELEGRAM_ADMIN_USER_ID),
    // Sin ella /simular usa la lectura básica por reglas y un canal real derivaría todo a Blake. Solo sí o no, nunca el valor.
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
  };

  let supabase = false;
  let supabaseError: string | undefined;
  try {
    const { error } = await getDb()
      .from("event_log")
      .select("id", { count: "exact", head: true });
    supabase = !error;
    if (error) supabaseError = error.message;
  } catch (e) {
    supabaseError = e instanceof Error ? e.message : "error";
  }

  let telegram = false;
  let bot: string | undefined;
  let telegramError: string | undefined;
  try {
    const me = await getMe();
    telegram = true;
    bot = me.username;
  } catch (e) {
    telegramError = e instanceof Error ? e.message : "error";
  }

  let webhook: { registrado: boolean; pendientes?: number; ultimoError?: string } = {
    registrado: false,
  };
  try {
    const info = await getWebhookInfo();
    webhook = {
      registrado: Boolean(info.url),
      pendientes: info.pending_update_count,
      ultimoError: info.last_error_message,
    };
  } catch {
    /* se refleja en telegram:false */
  }

  // Claude: de qué tipo parece la clave y si Anthropic la acepta (sin enseñarla). No cuenta para «ok»: sin clave Kira sigue vivo.
  const claude = await comprobarClaude();

  const ok = supabase && telegram;
  return NextResponse.json(
    { ok, supabase, supabaseError, telegram, bot, telegramError, webhook, env, claude },
    { status: ok ? 200 : 503 },
  );
}
