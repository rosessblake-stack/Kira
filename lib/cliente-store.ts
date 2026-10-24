import type { Fase, ConversacionCanal } from "./cliente-flow";
import { getDb } from "./db";
import type { Reserva } from "./proposal-flow";

/** Persistencia de la conversación con la clienta sobre Supabase (solo servidor, clave service_role). */

/** Fases en las que la conversación sigue viva. «liberada» tiene la reserva cancelada (el hueco está libre) pero la clienta aún puede decir «hecho». */
const FASES_ACTIVAS: Fase[] = ["precio_enviado", "pago_pedido", "pago_declarado", "liberada", "opciones_enviadas"];
/** Fases con plazo propio que cierra el temporizador (en «pago_declarado» decide Blake). */
const FASES_CON_PLAZO: Fase[] = ["precio_enviado", "pago_pedido", "liberada", "opciones_enviadas"];
/** «propuesta» vale para «opciones_enviadas» y para una solicitud aprobada SIN fecha (Tiempo 2: precio enviado, esperando el día que diga la clienta) (la clienta aún no tiene la cita aprobada). */
const ESTADOS_VIVOS = ["pendiente_pago", "cancelada", "propuesta"];
const CLAVE_BIZUM = "bizum_numero";

function ok(what: string, error: { message: string } | null) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export async function leerConversacion(id: string): Promise<ConversacionCanal | null> {
  const { data, error } = await getDb()
    .from("conversations")
    .select("id,channel,contact_ref,last_client_message_at")
    .eq("id", id)
    .maybeSingle();
  ok("No se pudo leer la conversación", error);
  const c = data as { id: string; channel: string; contact_ref: string; last_client_message_at: string | null } | null;
  if (!c) return null;
  return { id: c.id, canal: c.channel === "instagram" ? "instagram" : "prueba", contact_ref: c.contact_ref, last_client_message_at: c.last_client_message_at };
}

/**
 * Cambio de fase ATÓMICO: un UPDATE con la fase de partida dentro de la condición. Si dos ejecuciones llegan a la vez,
 * solo una devuelve fila. Se prueba cada fase de partida posible: como la reserva solo está en una, solo una puede cuadrar.
 */
export async function avanzarFase(id: string, de: (Fase | null)[], parche: Partial<Omit<Reserva, "id">>): Promise<Reserva | null> {
  for (const fase of de) {
    const base = getDb().from("bookings").update(parche).eq("id", id);
    const { data, error } = await (fase === null ? base.is("client_phase", null) : base.eq("client_phase", fase)).select("*");
    ok("No se pudo cambiar de fase", error);
    const filas = (data as Reserva[] | null) ?? [];
    if (filas.length === 1) return filas[0];
  }
  return null;
}

export async function reservaActivaDe(conversationId: string): Promise<Reserva | null> {
  const { data, error } = await getDb()
    .from("bookings")
    .select("*")
    .eq("conversation_id", conversationId)
    .in("status", ESTADOS_VIVOS)
    .in("client_phase", FASES_ACTIVAS)
    .order("created_at", { ascending: false })
    .limit(1);
  ok("No se pudo consultar la reserva de la conversación", error);
  return ((data as Reserva[] | null) ?? [])[0] ?? null;
}

/** La solicitud de esa conversación que Blake aún no ha decidido (estado propuesta, sin fase de clienta). */
export async function propuestaPendienteDe(conversationId: string): Promise<Reserva | null> {
  const { data, error } = await getDb()
    .from("bookings")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("status", "propuesta")
    .is("client_phase", null)
    .order("created_at", { ascending: false })
    .limit(1);
  ok("No se pudo consultar la propuesta pendiente", error);
  return ((data as Reserva[] | null) ?? [])[0] ?? null;
}

/** La última solicitud (real o de prueba) a la que se le han ofrecido opciones de hueco y espera su elección. */
export async function reservaConOpcionesActiva(): Promise<Reserva | null> {
  const { data, error } = await getDb().from("bookings").select("*").eq("status", "propuesta").eq("client_phase", "opciones_enviadas").order("created_at", { ascending: false }).limit(1);
  ok("No se pudo consultar las opciones pendientes", error);
  return ((data as Reserva[] | null) ?? [])[0] ?? null;
}

export async function reservaDePruebaActiva(): Promise<Reserva | null> {
  const { data, error } = await getDb()
    .from("bookings")
    .select("*")
    .eq("is_test", true)
    .in("status", ESTADOS_VIVOS)
    .in("client_phase", FASES_ACTIVAS)
    .order("created_at", { ascending: false })
    .limit(1);
  ok("No se pudo consultar la última prueba", error);
  return ((data as Reserva[] | null) ?? [])[0] ?? null;
}

export async function vencidas(ahora: Date, limite: number): Promise<Reserva[]> {
  const { data, error } = await getDb()
    .from("bookings")
    .select("*")
    .in("client_phase", FASES_CON_PLAZO)
    .lte("payment_deadline", ahora.toISOString())
    .order("payment_deadline", { ascending: true })
    .limit(limite);
  ok("No se pudieron consultar los plazos vencidos", error);
  return (data as Reserva[] | null) ?? [];
}

export async function leerBizum(): Promise<string | null> {
  const { data, error } = await getDb().from("app_settings").select("value").eq("key", CLAVE_BIZUM).maybeSingle();
  ok("No se pudo leer el Bizum", error);
  const v = (data as { value?: unknown } | null)?.value;
  return typeof v === "string" && /^[6-9]\d{8}$/.test(v) ? v : null;
}

export async function guardarBizum(numero: string): Promise<void> {
  const { error } = await getDb().from("app_settings").upsert({ key: CLAVE_BIZUM, value: numero, updated_at: new Date().toISOString(), updated_by: "telegram" });
  ok("No se pudo guardar el Bizum", error);
}

/** La conversación de Instagram de un contacto de ManyChat (null si nunca ha mandado una solicitud). */
export async function conversacionDeInstagram(contactoId: string): Promise<string | null> {
  const { data, error } = await getDb().from("conversations").select("id").eq("channel", "instagram").eq("contact_ref", contactoId).maybeSingle();
  ok("No se pudo buscar la conversación", error);
  return (data as { id: string } | null)?.id ?? null;
}

/** La última cita pagada de esa conversación a la que aún le falta el correo (para pedírselo tras confirmar). */
export async function citaSinEmailDe(conversationId: string): Promise<Reserva | null> {
  const { data, error } = await getDb()
    .from("bookings")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("status", "pagada")
    .is("client_email", null)
    .gte("created_at", new Date(Date.now() - 14 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  ok("No se pudo consultar la cita sin correo", error);
  return ((data as Reserva[] | null) ?? [])[0] ?? null;
}
