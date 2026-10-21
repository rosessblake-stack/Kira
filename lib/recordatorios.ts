import { getDb } from "./db";
import { botonInstagram } from "./instagram";
import { limpiarTexto } from "./intents";
import * as tg from "./telegram";

/**
 * Recordatorio de propuestas sin decidir (petición de Blake, 21-oct): si una solicitud REAL lleva ≥2 h esperando
 * Aprobar / Editar / Rechazar, Kira se lo recuerda con botones (Ver propuesta + Instagram). Como mucho cada 3 h,
 * solo de 9:00 a 22:00 hora de Madrid, y solo las de los últimos 3 días. Mejor esfuerzo: nunca rompe el temporizador.
 */
const CLAVE = "recordatorio_pendientes";
const HORA_MS = 3_600_000;
const MIN_ESPERA_MS = 2 * HORA_MS;
const MAX_EDAD_MS = 72 * HORA_MS;
const ENTRE_AVISOS_MS = 3 * HORA_MS;
const MAX_LISTA = 5;

export function horaEnMadrid(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Madrid" }).format(d)) % 24;
}

type Fila = { id: string; client_name: string | null; spec: { instagram?: string; nombre?: string } | null; created_at: string };

export async function recordarPendientes(ahora = new Date()): Promise<number> {
  const raw = process.env.TELEGRAM_ADMIN_USER_ID;
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const hora = horaEnMadrid(ahora);
  if (hora < 9 || hora >= 22) return 0;
  const db = getDb();
  const { data: ajuste } = await db.from("app_settings").select("value").eq("key", CLAVE).maybeSingle();
  const ultimo = typeof ajuste?.value === "string" ? Date.parse(ajuste.value) : NaN;
  if (!Number.isNaN(ultimo) && ahora.getTime() - ultimo < ENTRE_AVISOS_MS) return 0;
  const { data, error } = await db
    .from("bookings")
    .select("id, client_name, spec, created_at")
    .eq("status", "propuesta")
    .eq("is_test", false)
    .is("client_phase", null)
    .lte("created_at", new Date(ahora.getTime() - MIN_ESPERA_MS).toISOString())
    .gte("created_at", new Date(ahora.getTime() - MAX_EDAD_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(error.message);
  const lista = (data ?? []) as Fila[];
  if (!lista.length) return 0;
  const chat = Number(raw);
  const mostrar = lista.slice(0, MAX_LISTA);
  const lineas = mostrar.map((r) => {
    const h = Math.floor((ahora.getTime() - Date.parse(r.created_at)) / HORA_MS);
    const ig = r.spec?.instagram ? ` (@${r.spec.instagram.replace(/^@/, "")})` : "";
    return `• ${limpiarTexto(r.client_name || r.spec?.nombre || "(sin nombre)", 40)}${ig} · hace ${h} h`;
  });
  const extra = lista.length > MAX_LISTA ? `\n…y ${lista.length - MAX_LISTA} más: mira /pendientes.` : "";
  await tg.sendMessage(chat, `⏳ Tienes ${lista.length} ${lista.length === 1 ? "solicitud" : "solicitudes"} SIN decidir (Aprobar / Editar / Rechazar):\n\n${lineas.join("\n")}${extra}`, {
    inline_keyboard: mostrar.map((r) => {
      const fila: { text: string; callback_data?: string; url?: string }[] = [{ text: `📋 ${limpiarTexto(r.client_name || r.spec?.nombre || "Ver", 20)}`, callback_data: `v:${r.id.replace(/-/g, "")}` }];
      return [...fila, ...botonInstagram(r.spec?.instagram)];
    }),
  });
  await db.from("app_settings").upsert({ key: CLAVE, value: ahora.toISOString(), updated_at: ahora.toISOString(), updated_by: "cron" });
  return lista.length;
}

/**
 * Recordatorio de pagos por comprobar (Fase 1, 21-oct): la clienta dijo que ya hizo el Bizum y Blake no ha pulsado ✅ ni ❌.
 * Como mucho cada hora, de 9:00 a 22:00 Madrid, a partir de 30 min de espera. Con el botón de su Instagram.
 */
const CLAVE_PAGOS = "recordatorio_pagos";

export async function recordarPagos(ahora = new Date()): Promise<number> {
  const raw = process.env.TELEGRAM_ADMIN_USER_ID;
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const hora = horaEnMadrid(ahora);
  if (hora < 9 || hora >= 22) return 0;
  const db = getDb();
  const { data: ajuste } = await db.from("app_settings").select("value").eq("key", CLAVE_PAGOS).maybeSingle();
  const ultimo = typeof ajuste?.value === "string" ? Date.parse(ajuste.value) : NaN;
  if (!Number.isNaN(ultimo) && ahora.getTime() - ultimo < HORA_MS) return 0;
  const { data, error } = await db
    .from("bookings")
    .select("id, client_name, spec, created_at")
    .eq("client_phase", "pago_declarado")
    .eq("status", "pendiente_pago")
    .lte("updated_at", new Date(ahora.getTime() - 30 * 60_000).toISOString())
    .gte("updated_at", new Date(ahora.getTime() - MAX_EDAD_MS).toISOString())
    .limit(10);
  if (error) throw new Error(error.message);
  const lista = (data ?? []) as Fila[];
  if (!lista.length) return 0;
  await tg.sendMessage(
    Number(raw),
    `💶 ${lista.length === 1 ? "Una clienta dice" : `${lista.length} clientas dicen`} que ya hizo el Bizum y no has confirmado si te llegó:\n\n${lista.map((r) => `• ${limpiarTexto(r.client_name || r.spec?.nombre || "(sin nombre)", 40)}${r.spec?.instagram ? ` (@${r.spec.instagram.replace(/^@/, "")})` : ""}`).join("\n")}\n\nMira tu banco y pulsa ✅ o ❌ en su mensaje (o /pendientes).`,
    {
      inline_keyboard: lista.map((r) => botonInstagram(r.spec?.instagram)).filter((f) => f.length),
    },
  );
  await db.from("app_settings").upsert({ key: CLAVE_PAGOS, value: ahora.toISOString(), updated_at: ahora.toISOString(), updated_by: "cron" });
  return lista.length;
}
