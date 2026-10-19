import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { handleTelegramRequest, type Config, type Deps } from "../../../lib/telegram-handler";
import * as db from "../../../lib/db";
import * as tg from "../../../lib/telegram";

export const dynamic = "force-dynamic";

function readConfig(): Config {
  const raw = process.env.TELEGRAM_ADMIN_USER_ID?.trim();
  return {
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    adminUserId: raw && /^\d+$/.test(raw) ? Number(raw) : null,
  };
}

const deps: Deps = {
  recordUpdate: db.recordUpdate,
  logEvent: (e) => db.logEvent("telegram", e),
  logSecurity: db.logSecurity,
  hasIssuedTest: db.hasIssuedTest,
  sendMessage: tg.sendMessage,
  answerCallback: tg.answerCallback,
  editMessage: tg.editMessage,
  newNonce: () => randomUUID().replace(/-/g, ""),
};

export async function POST(req: Request) {
  const rawBody = await req.text();
  try {
    const result = await handleTelegramRequest(
      req.headers.get("x-telegram-bot-api-secret-token"),
      rawBody,
      readConfig(),
      deps,
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
