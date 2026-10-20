import { getDb } from "./db";
import { interpretarPerfil, type PerfilLegacy } from "./pricing";
import { CONFIG_UBICACION, type Ubicacion } from "./ubicacion";
import type { NuevaReserva, Reserva } from "./proposal-flow";

/** Persistencia real del flujo de propuestas, sobre Supabase (solo servidor, clave service_role). */

function ok(what: string, error: { message: string } | null) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export async function crearConversacion(canal: "prueba" | "instagram", ref: string, nombre: string): Promise<string> {
  const db = getDb();
  if (canal === "instagram") {
    // Un contacto de ManyChat = una conversación: si vuelve a pedir cita se reutiliza (unique canal+contacto).
    const buscar = async () => {
      const { data, error } = await db.from("conversations").select("id").eq("channel", "instagram").eq("contact_ref", ref).maybeSingle();
      ok("No se pudo buscar la conversación", error);
      return (data as { id: string } | null)?.id ?? null;
    };
    const existente = await buscar();
    if (existente) {
      const { error } = await db.from("conversations").update({ display_name: nombre, status: "abierta" }).eq("id", existente);
      ok("No se pudo reabrir la conversación", error);
      return existente;
    }
    const { data, error } = await db.from("conversations").insert({ channel: canal, contact_ref: ref, display_name: nombre }).select("id").single();
    if (error?.code === "23505") {
      // Dos solicitudes a la vez del mismo contacto: la otra ganó la carrera.
      const id = await buscar();
      if (id) return id;
    }
    ok("No se pudo crear la conversación", error);
    return (data as { id: string }).id;
  }
  const { data, error } = await db.from("conversations").insert({ channel: canal, contact_ref: ref, display_name: nombre }).select("id").single();
  ok("No se pudo crear la conversación", error);
  return (data as { id: string }).id;
}

/** Mensajes de la clienta en la última hora (límite de ritmo). */
export async function contarMensajesClienteUltimaHora(conversationId: string): Promise<number> {
  const { count, error } = await getDb()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("direction", "in")
    .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
  ok("No se pudo contar los mensajes", error);
  return count ?? 0;
}

export async function guardarMensaje(conversationId: string, direccion: "in" | "out", cuerpo: string, marcado: boolean) {
  const { error } = await getDb()
    .from("messages")
    .insert({ conversation_id: conversationId, direction: direccion, body: cuerpo, flagged: marcado });
  ok("No se pudo guardar el mensaje", error);
}

export async function marcarMensajeSospechoso(conversationId: string) {
  const { error } = await getDb()
    .from("messages")
    .update({ flagged: true })
    .eq("conversation_id", conversationId)
    .eq("direction", "in");
  ok("No se pudo marcar el mensaje", error);
}

export async function actualizarConversacion(
  id: string,
  patch: { intent?: string; status?: string; last_client_message_at?: string },
) {
  const { error } = await getDb().from("conversations").update(patch).eq("id", id);
  ok("No se pudo actualizar la conversación", error);
}

export async function crearReserva(r: NuevaReserva): Promise<Reserva> {
  const { data, error } = await getDb().from("bookings").insert(r).select("*").single();
  ok("No se pudo crear la reserva", error);
  return data as Reserva;
}

export async function actualizarReserva(id: string, patch: Partial<Omit<Reserva, "id">>): Promise<Reserva> {
  const { data, error } = await getDb().from("bookings").update(patch).eq("id", id).select("*").single();
  ok("No se pudo actualizar la reserva", error);
  return data as Reserva;
}

export async function leerReserva(id: string): Promise<Reserva> {
  const { data, error } = await getDb().from("bookings").select("*").eq("id", id).single();
  ok("No se pudo leer la reserva", error);
  return data as Reserva;
}

export async function verReservaPorNonce(nonce: string): Promise<Reserva | null> {
  const { data, error } = await getDb().from("bookings").select("*").eq("proposal_nonce", nonce).maybeSingle();
  ok("No se pudo consultar el botón", error);
  return (data as Reserva | null) ?? null;
}

/**
 * Gasta el nonce de forma atómica: un solo UPDATE con las condiciones dentro. Si dos pulsaciones llegan a la vez,
 * solo una devuelve fila; la otra recibe null.
 */
export async function tomarNonce(nonce: string, estado = "propuesta"): Promise<Reserva | null> {
  const { data, error } = await getDb()
    .from("bookings")
    .update({ proposal_nonce: null })
    .eq("proposal_nonce", nonce)
    .eq("status", estado)
    .select("*");
  ok("No se pudo gastar el botón", error);
  const filas = (data as Reserva[] | null) ?? [];
  return filas.length === 1 ? filas[0] : null;
}

export async function reservaEnEdicion(): Promise<Reserva | null> {
  const { data, error } = await getDb()
    .from("bookings")
    .select("*")
    .eq("status", "propuesta")
    .not("edit_requested_at", "is", null)
    .order("edit_requested_at", { ascending: false })
    .limit(1);
  ok("No se pudo consultar la edición", error);
  const filas = (data as Reserva[] | null) ?? [];
  return filas[0] ?? null;
}

/** Reservas que pueden haberse quedado sin botones: propuestas y citas provisionales de los últimos días, las más recientes primero. */
export async function listarPendientes(): Promise<Reserva[]> {
  const { data, error } = await getDb()
    .from("bookings")
    .select("*")
    .in("status", ["propuesta", "pendiente_pago"])
    .gte("created_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(30);
  ok("No se pudieron consultar las reservas pendientes", error);
  return (data as Reserva[] | null) ?? [];
}

/** Llamadas a Claude en las últimas 24 h (para el tope diario de gasto). */
export async function contarLlamadasClaudeHoy(): Promise<number> {
  const { count, error } = await getDb()
    .from("event_log")
    .select("id", { count: "exact", head: true })
    .eq("source", "claude")
    .eq("kind", "claude_llamada")
    .gte("at", new Date(Date.now() - 24 * 3_600_000).toISOString());
  ok("No se pudo contar las llamadas a Claude", error);
  return count ?? 0;
}

/**
 * Perfil de precios de Blake en ese lugar (app_settings: `perfil_legacy` para España, `perfil_legacy_miami` para Miami).
 * Sin nada guardado, el de Blake por defecto; si lo guardado está roto, el mismo pero marcado «sin confirmar».
 */
export async function perfilGuardado(ubicacion: Ubicacion = "espana"): Promise<PerfilLegacy> {
  const cfg = CONFIG_UBICACION[ubicacion];
  const { data, error } = await getDb().from("app_settings").select("value").eq("key", cfg.clavePerfil).maybeSingle();
  if (error) return interpretarPerfil(null, cfg.perfilPorDefecto);
  return interpretarPerfil((data as { value: unknown } | null)?.value, cfg.perfilPorDefecto);
}
