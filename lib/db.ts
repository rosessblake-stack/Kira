import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SecurityKind } from "./telegram-handler";

/** Cliente de Supabase con la clave de servidor. Solo se usa en el servidor. */
export function getDb(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan variables de Supabase");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Devuelve true si es nuevo; false si ya estaba (idempotencia). */
export async function recordUpdate(provider: string, externalId: string): Promise<boolean> {
  const { error } = await getDb()
    .from("processed_webhooks")
    .insert({ provider, external_id: externalId });
  if (!error) return true;
  if (error.code === "23505") return false; // clave duplicada
  throw new Error(`No se pudo registrar el aviso: ${error.message}`);
}

type Source = "manychat" | "stripe" | "telegram" | "typeform" | "claude" | "calendar" | "legacy" | "system";

/** El registro es de mejor esfuerzo: nunca debe tumbar una petición. */
export async function logEvent(
  source: Source,
  e: { kind: string; level?: "info" | "warn" | "error"; summary: string; detail?: Record<string, unknown> },
): Promise<void> {
  try {
    const { error } = await getDb().from("event_log").insert({
      source,
      kind: e.kind,
      level: e.level ?? "info",
      summary: e.summary,
      detail: e.detail ?? {},
    });
    if (error) console.error("event_log:", error.message);
  } catch (err) {
    console.error("event_log:", err instanceof Error ? err.message : "error");
  }
}

export async function logSecurity(e: {
  kind: SecurityKind;
  source: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await getDb().from("security_events").insert({
      kind: e.kind,
      source: e.source,
      detail: e.detail ?? {},
    });
    if (error) console.error("security_events:", error.message);
  } catch (err) {
    console.error("security_events:", err instanceof Error ? err.message : "error");
  }
}

export async function hasIssuedTest(nonce: string): Promise<boolean> {
  const { data, error } = await getDb()
    .from("event_log")
    .select("id")
    .eq("source", "telegram")
    .eq("kind", "prueba_enviada")
    .filter("detail->>nonce", "eq", nonce)
    .limit(1);
  if (error) throw new Error(`No se pudo comprobar el botón: ${error.message}`);
  return (data?.length ?? 0) > 0;
}
