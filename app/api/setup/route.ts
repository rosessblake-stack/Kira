import { NextResponse } from "next/server";
import { logEvent, logSecurity } from "../../../lib/db";
import { safeEqual } from "../../../lib/safe-equal";
import { setWebhook } from "../../../lib/telegram";

export const dynamic = "force-dynamic";

/**
 * Registra el aviso (webhook) del bot en Telegram.
 * Protegido con el mismo secreto del webhook. Se usa una vez al publicar
 * y cada vez que cambie la dirección o se rote el secreto.
 */
export async function GET(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const key = new URL(req.url).searchParams.get("key");

  if (!secret || !safeEqual(key, secret)) {
    await logSecurity({ kind: "firma_invalida", source: "setup" });
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? req.headers.get("host");
  if (!host) return NextResponse.json({ ok: false, error: "sin_host" }, { status: 500 });
  const url = `https://${host}/api/telegram`;

  try {
    await setWebhook(url, secret);
    await logEvent("system", {
      kind: "webhook_registrado",
      summary: "Webhook de Telegram registrado",
      detail: { url },
    });
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "error";
    await logEvent("system", {
      kind: "webhook_error",
      level: "error",
      summary: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
