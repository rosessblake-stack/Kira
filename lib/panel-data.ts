import { cache } from "react";
import { getDb } from "./db";
import { ETIQUETA_FOTO, type TipoFoto } from "./fotos";
import {
  UMBRALES,
  contarPorTipo,
  filasDeMapeo,
  filasDePrecio,
  lineaDeTiempo,
  monedaDeSpec,
  pasoDeConversacion,
  problemasDeReservas,
  problemasDeTareas,
  problemasDeWebhook,
  type Fila,
  type ItemLinea,
  type Paso,
  type Problema,
  type ReservaRow,
  type TareaRow,
  type WebhookInfoLite,
  zonaDeSpec,
} from "./panel-rules";
import type { Moneda } from "./ubicacion";
import type { Admin } from "./panel-session";
import { getWebhookInfo } from "./telegram";

/**
 * Lecturas del panel. Solo servidor, con la clave service_role.
 * Todas exigen la prueba `Admin` que solo entrega requireAdmin().
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const haceDias = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const haceHoras = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function must<T>(what: string, res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T;
}

function count(what: string, res: { count: number | null; error: { message: string } | null }): number {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.count ?? 0;
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

export type ConversacionResumen = {
  id: string;
  canal: string;
  nombre: string;
  intent: string;
  ultimoMensaje: string | null;
  actualizada: string;
  paso: Paso;
};

type ConvRow = {
  id: string;
  channel: string;
  display_name: string | null;
  contact_ref: string;
  intent: string;
  status: string;
  last_client_message_at: string | null;
  updated_at: string;
};

export async function listarConversaciones(_a: Admin): Promise<ConversacionResumen[]> {
  const db = getDb();
  const convs = must<ConvRow[]>(
    "conversaciones",
    await db
      .from("conversations")
      .select("id,channel,display_name,contact_ref,intent,status,last_client_message_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(100),
  );
  if (convs.length === 0) return [];

  const reservas = must<{ conversation_id: string; status: string }[]>(
    "reservas",
    await db
      .from("bookings")
      .select("conversation_id,status,created_at")
      .in("conversation_id", convs.map((c) => c.id))
      .order("created_at", { ascending: false }),
  );
  const ultima = new Map<string, { status: string }>();
  for (const r of reservas) if (!ultima.has(r.conversation_id)) ultima.set(r.conversation_id, r);

  return convs.map((c) => ({
    id: c.id,
    canal: c.channel,
    nombre: c.display_name ?? c.contact_ref,
    intent: c.intent,
    ultimoMensaje: c.last_client_message_at,
    actualizada: c.updated_at,
    paso: pasoDeConversacion(c, ultima.get(c.id)),
  }));
}

export type ReservaDetalle = {
  id: string;
  estado: string;
  esPrueba: boolean;
  cliente: string;
  servicio: string;
  inicio: string | null;
  fin: string | null;
  precioCentimos: number | null;
  senalCentimos: number | null;
  /** Moneda y zona horaria de la ciudad de la clienta (España o Miami). */
  moneda: Moneda;
  zona: string;
  mapeo: Fila[];
  precio: Fila[];
  avisos: string[];
  borrador: string | null;
};

export type FotoPanel = {
  id: string;
  tipo: TipoFoto;
  etiqueta: string;
  descripcion: string | null;
  creada: string;
  /** null = se conserva siempre (fotos de referencia). */
  caduca: string | null;
  /** El archivo ya se borró por caducidad; la descripción se conserva. */
  borrada: boolean;
};

export type DetalleConversacion = {
  canal: string;
  fotos: FotoPanel[];
  nombre: string;
  intent: string;
  reservas: ReservaDetalle[];
  paso: Paso;
  ultimoMensaje: string | null;
  linea: ItemLinea[];
};

export async function detalleConversacion(_a: Admin, id: string): Promise<DetalleConversacion | null> {
  if (!UUID_RE.test(id)) return null;
  const db = getDb();

  const conv = (
    await db
      .from("conversations")
      .select("id,channel,display_name,contact_ref,intent,status,last_client_message_at,updated_at")
      .eq("id", id)
      .maybeSingle()
  ).data as ConvRow | null;
  if (!conv) return null;

  const [mensajes, eventos, reservas, fotos] = await Promise.all([
    db
      .from("messages")
      .select("created_at,direction,body,flagged")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .limit(200),
    db
      .from("event_log")
      .select("at,source,kind,level,summary")
      .eq("conversation_id", id)
      .order("at", { ascending: true })
      .limit(200),
    db
      .from("bookings")
      .select("id,created_at,status,is_test,client_name,service_description,price_cents,deposit_cents,starts_at,ends_at,spec,pricing,warnings,reply_draft")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),
    db
      .from("attachments")
      .select("id,kind,description,created_at,expires_at,purged_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const reservasRows = must<
    {
      id: string; created_at: string; status: string; is_test: boolean; client_name: string; service_description: string;
      price_cents: number | null; deposit_cents: number | null; starts_at: string | null; ends_at: string | null;
      spec: unknown; pricing: unknown; warnings: unknown; reply_draft: string | null;
    }[]
  >("reservas", reservas);
  const ultima = reservasRows.at(-1);

  const fotosRows = must<{ id: string; kind: TipoFoto; description: string | null; created_at: string; expires_at: string | null; purged_at: string | null }[]>("fotos", fotos);

  return {
    canal: conv.channel,
    fotos: fotosRows.map((f) => ({
      id: f.id,
      tipo: f.kind,
      etiqueta: ETIQUETA_FOTO[f.kind] ?? "Foto",
      descripcion: f.description,
      creada: f.created_at,
      caduca: f.expires_at,
      borrada: Boolean(f.purged_at),
    })),
    reservas: reservasRows.map((r) => ({
      id: r.id,
      estado: r.status,
      esPrueba: r.is_test,
      cliente: r.client_name,
      servicio: r.service_description,
      inicio: r.starts_at,
      fin: r.ends_at,
      precioCentimos: r.price_cents,
      senalCentimos: r.deposit_cents,
      moneda: monedaDeSpec(r.spec),
      zona: zonaDeSpec(r.spec),
      mapeo: filasDeMapeo(r.spec),
      precio: filasDePrecio(r.pricing),
      avisos: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === "string") : [],
      borrador: r.reply_draft,
    })),
    nombre: conv.display_name ?? conv.contact_ref,
    intent: conv.intent,
    paso: pasoDeConversacion(conv, ultima),
    ultimoMensaje: conv.last_client_message_at,
    linea: lineaDeTiempo(
      must("mensajes", mensajes),
      must("eventos", eventos),
      reservasRows,
    ),
  };
}

export type EventoReciente = {
  id: number;
  at: string;
  source: string;
  kind: string;
  level: string;
  summary: string;
  conversation_id: string | null;
};

export async function actividadReciente(_a: Admin, limite = 30): Promise<EventoReciente[]> {
  return must<EventoReciente[]>(
    "actividad",
    await getDb()
      .from("event_log")
      .select("id,at,source,kind,level,summary,conversation_id")
      .order("at", { ascending: false })
      .limit(limite),
  );
}

// ---------------------------------------------------------------------------
// Fallos
// ---------------------------------------------------------------------------

export type Fallos = {
  /** Cosas que deberían haberse cerrado y no se han cerrado. */
  problemas: Problema[];
  /** Errores y avisos registrados en los últimos días. */
  registrados: EventoReciente[];
  registradosUltimas24h: number;
};

/** Cacheada por petición: el layout (insignia) y la página la comparten. */
export const cargarFallos = cache(async (_a: Admin): Promise<Fallos> => {
  const db = getDb();
  const ahora = new Date();
  const [pendientes, pagadasSinEvento, tareasAbiertas, tareasFallidas, registrados] = await Promise.all([
    db
      .from("bookings")
      .select("id,conversation_id,client_name,status,payment_deadline,approved_at,created_at,calendar_event_id,is_test")
      .in("status", ["propuesta", "aprobada", "pendiente_pago"])
      .limit(300),
    db
      .from("bookings")
      .select("id,conversation_id,client_name,status,payment_deadline,approved_at,created_at,calendar_event_id,is_test")
      .eq("status", "pagada")
      .is("calendar_event_id", null)
      .limit(100),
    db
      .from("scheduled_jobs")
      .select("id,kind,status,run_at,locked_at,attempts,last_error")
      .in("status", ["pendiente", "en_curso"])
      .limit(300),
    db
      .from("scheduled_jobs")
      .select("id,kind,status,run_at,locked_at,attempts,last_error")
      .eq("status", "fallido")
      .gte("run_at", haceDias(UMBRALES.ventanaFallosDias))
      .limit(100),
    db
      .from("event_log")
      .select("id,at,source,kind,level,summary,conversation_id")
      .in("level", ["warn", "error"])
      .gte("at", haceDias(UMBRALES.ventanaFallosDias))
      .order("at", { ascending: false })
      .limit(100),
  ]);

  const reservas = [
    ...must<ReservaRow[]>("reservas abiertas", pendientes),
    ...must<ReservaRow[]>("reservas pagadas", pagadasSinEvento),
  ];
  const tareas = [
    ...must<TareaRow[]>("tareas abiertas", tareasAbiertas),
    ...must<TareaRow[]>("tareas fallidas", tareasFallidas),
  ];
  const reg = must<EventoReciente[]>("errores", registrados);
  const corte24 = Date.now() - 24 * 3_600_000;

  return {
    problemas: [...problemasDeReservas(reservas, ahora), ...problemasDeTareas(tareas, ahora)],
    registrados: reg,
    registradosUltimas24h: reg.filter((e) => Date.parse(e.at) >= corte24).length,
  };
});

const TIMEOUT_TELEGRAM_MS = 4000;

/** Consulta a Telegram (red): solo la usa la página de Fallos. null si no responde. */
export async function problemasDeTelegram(_a: Admin): Promise<{ info: WebhookInfoLite | null; problemas: Problema[] }> {
  try {
    const info = await Promise.race([
      getWebhookInfo(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("tiempo agotado")), TIMEOUT_TELEGRAM_MS)),
    ]);
    const lite: WebhookInfoLite = {
      registrado: Boolean(info.url),
      pendientes: info.pending_update_count ?? 0,
      ultimoError: info.last_error_message ?? null,
      ultimoErrorFecha: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
    };
    return { info: lite, problemas: problemasDeWebhook(lite, new Date()) };
  } catch {
    return {
      info: null,
      problemas: [
        {
          clave: "telegram:sin_respuesta",
          gravedad: "aviso",
          titulo: "No se pudo consultar a Telegram",
          detalle: "No se ha podido comprobar el estado del webhook. Puede ser algo pasajero.",
          desde: new Date().toISOString(),
        },
      ],
    };
  }
}

// ---------------------------------------------------------------------------
// Seguridad
// ---------------------------------------------------------------------------

export type EventoSeguridad = {
  id: number;
  at: string;
  kind: string;
  source: string;
  conversation_id: string | null;
  detail: unknown;
};

export type MensajeMarcado = {
  id: string;
  conversation_id: string;
  body: string;
  created_at: string;
};

export type Seguridad = {
  eventos: EventoSeguridad[];
  /** Hay más eventos de los que se muestran. */
  recortado: boolean;
  ultimas24h: Record<string, number>;
  ultimos7d: Record<string, number>;
  marcados: MensajeMarcado[];
};

const MAX_EVENTOS_SEGURIDAD = 200;

export async function cargarSeguridad(_a: Admin): Promise<Seguridad> {
  const db = getDb();
  const ahora = new Date();
  const [eventos, marcados] = await Promise.all([
    db
      .from("security_events")
      .select("id,at,kind,source,conversation_id,detail")
      .gte("at", haceDias(UMBRALES.ventanaSeguridadDias))
      .order("at", { ascending: false })
      .limit(MAX_EVENTOS_SEGURIDAD),
    db
      .from("messages")
      .select("id,conversation_id,body,created_at")
      .eq("flagged", true)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const rows = must<EventoSeguridad[]>("eventos de seguridad", eventos);
  return {
    eventos: rows,
    recortado: rows.length >= MAX_EVENTOS_SEGURIDAD,
    ultimas24h: contarPorTipo(rows, ahora, 24),
    ultimos7d: contarPorTipo(rows, ahora, 24 * 7),
    marcados: must<MensajeMarcado[]>("mensajes marcados", marcados),
  };
}

// ---------------------------------------------------------------------------
// Insignias de las pestañas
// ---------------------------------------------------------------------------

export async function resumenSalud(a: Admin): Promise<{ fallos: number; seguridad24h: number }> {
  const [fallos, seg] = await Promise.all([
    cargarFallos(a),
    getDb()
      .from("security_events")
      .select("id", { count: "exact", head: true })
      .gte("at", haceHoras(24)),
  ]);
  return {
    fallos: fallos.problemas.length + fallos.registradosUltimas24h,
    seguridad24h: count("eventos de seguridad", seg),
  };
}
