/**
 * Reglas puras del panel: en qué paso está cada conversación, qué cuenta como
 * fallo y cómo se muestran fechas. Sin acceso a datos, para poder probarlas.
 */

import { horasTexto } from "./agenda";
import { CONFIG_UBICACION, SIMBOLO, dinero, interpretarUbicacion, type Moneda } from "./ubicacion";

export const UMBRALES = {
  /** Una propuesta sin tu Aprobar durante más de esto es un aviso. */
  propuestaSinAprobarMin: 30,
  /** Margen tras el plazo de pago para que el temporizador (cron cada minuto) actúe. */
  pagoVencidoMargenMin: 2,
  /** Aprobada pero sin enlace de pago pasado este tiempo. */
  aprobadaSinEnlaceMin: 5,
  /** Reserva provisional en el calendario esperando que Blake pulse «Señal recibida» o «Cancelar cita». */
  provisionalSinSenalMin: 60,
  /** Igual que claim_due_jobs(): una tarea en curso más de 5 min se da por atascada. */
  tareaAtascadaMin: 5,
  /** Tarea pendiente cuya hora pasó hace más de esto: el cron no está corriendo. */
  tareaVencidaMin: 2,
  ventanaFallosDias: 7,
  ventanaSeguridadDias: 30,
} as const;

export const INTENCIONES: Record<string, string> = {
  cita_salon: "Cita de salón",
  formacion_online: "Formación online",
  infoproducto: "Infoproducto",
  formacion_presencial: "Formación presencial",
  otro: "Otro",
  desconocido: "Sin clasificar",
};

export const ESTADOS_RESERVA: Record<string, string> = {
  propuesta: "Propuesta",
  aprobada: "Aprobada",
  pendiente_pago: "Pendiente de pago",
  pagada: "Pagada",
  expirada: "Expirada",
  cancelada: "Cancelada",
};

export const TIPOS_SEGURIDAD: Record<string, string> = {
  firma_invalida: "Firma inválida",
  telegram_no_autorizado: "Telegram: usuario no autorizado",
  limite_de_peticiones: "Límite de peticiones superado",
  posible_inyeccion: "Posible manipulación del modelo",
  payload_inesperado: "Datos inesperados",
  acceso_panel_denegado: "Acceso al panel denegado",
};

export const CANALES: Record<string, string> = {
  instagram: "Instagram",
  prueba: "Prueba",
};

export const TIPOS_TAREA: Record<string, string> = {
  expirar_reserva: "Expirar reserva",
  seguimiento_typeform: "Seguimiento de Typeform",
  recordatorio: "Recordatorio",
};

// ---------------------------------------------------------------------------
// Proceso: en qué paso está una conversación
// ---------------------------------------------------------------------------

export type Tono = "ok" | "espera" | "mal" | "neutro";
export type Paso = { etiqueta: string; tono: Tono };

export function pasoDeConversacion(
  conv: { status: string; intent: string },
  reserva?: { status: string } | null,
): Paso {
  if (reserva) {
    switch (reserva.status) {
      case "pagada":
        return { etiqueta: "Pagada", tono: "ok" };
      case "pendiente_pago":
        return { etiqueta: "Pendiente de pago", tono: "espera" };
      case "aprobada":
        return { etiqueta: "Aprobada, falta el enlace de pago", tono: "espera" };
      case "propuesta":
        return { etiqueta: "Esperando tu aprobación", tono: "espera" };
      case "expirada":
        return { etiqueta: "Expirada (no pagó a tiempo)", tono: "mal" };
      case "cancelada":
        return { etiqueta: "Cancelada", tono: "neutro" };
    }
  }
  switch (conv.status) {
    case "esperando_aprobacion":
      return { etiqueta: "Esperando tu aprobación", tono: "espera" };
    case "esperando_cliente":
      return { etiqueta: "Esperando al cliente", tono: "espera" };
    case "cerrada":
      return { etiqueta: "Cerrada", tono: "neutro" };
    default:
      return conv.intent === "desconocido"
        ? { etiqueta: "Nueva, sin clasificar", tono: "espera" }
        : { etiqueta: "Clasificada", tono: "espera" };
  }
}

// ---------------------------------------------------------------------------
// Fallos: cosas que deberían haberse cerrado y no se han cerrado
// ---------------------------------------------------------------------------

export type Problema = {
  clave: string;
  gravedad: "error" | "aviso";
  titulo: string;
  detalle: string;
  /** Desde cuándo ocurre (ISO). */
  desde: string;
  conversationId?: string | null;
};

export type ReservaRow = {
  id: string;
  conversation_id: string | null;
  client_name: string;
  status: string;
  payment_deadline: string | null;
  approved_at: string | null;
  created_at: string;
  calendar_event_id: string | null;
  /** Reserva de una conversación simulada con /simular. */
  is_test?: boolean;
};

export type TareaRow = {
  id: string;
  kind: string;
  status: string;
  run_at: string;
  locked_at: string | null;
  attempts: number;
  last_error: string | null;
};

const minutosDesde = (iso: string, ahora: Date) => (ahora.getTime() - Date.parse(iso)) / 60_000;

export function duracion(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

export function recortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1)}…`;
}

export function problemasDeReservas(rows: ReservaRow[], ahora: Date): Problema[] {
  const out: Problema[] = [];
  for (const r of rows) {
    const base = { conversationId: r.conversation_id };
    const prueba = r.is_test ? "Reserva de prueba. " : "";
    if (r.status === "propuesta") {
      const min = minutosDesde(r.created_at, ahora);
      if (min > UMBRALES.propuestaSinAprobarMin) {
        out.push({
          ...base,
          clave: `reserva:${r.id}:propuesta`,
          gravedad: "aviso",
          titulo: "Propuesta sin aprobar",
          detalle: `${prueba}La propuesta para ${r.client_name} lleva ${duracion(min)} esperando tu decisión.`,
          desde: r.created_at,
        });
      }
    } else if (r.status === "aprobada") {
      const desde = r.approved_at ?? r.created_at;
      const min = minutosDesde(desde, ahora);
      if (min > UMBRALES.aprobadaSinEnlaceMin) {
        out.push({
          ...base,
          clave: `reserva:${r.id}:aprobada`,
          gravedad: "aviso",
          titulo: "Aprobada sin enlace de pago",
          detalle: `${prueba}La reserva de ${r.client_name} se aprobó hace ${duracion(min)} y no ha pasado a pendiente de pago.`,
          desde,
        });
      }
    } else if (r.status === "pendiente_pago") {
      if (!r.payment_deadline && r.calendar_event_id) {
        // Reserva provisional creada por Aprobar: no tiene plazo (aún no hay temporizador); espera tu botón.
        const desde = r.approved_at ?? r.created_at;
        const min = minutosDesde(desde, ahora);
        if (min > UMBRALES.provisionalSinSenalMin) {
          out.push({
            ...base,
            clave: `reserva:${r.id}:provisional`,
            gravedad: "aviso",
            titulo: "Reserva provisional sin señal confirmada",
            detalle: `${prueba}La reserva de ${r.client_name} lleva ${duracion(min)} en amarillo en tu calendario. Pulsa «Señal recibida» si ya pagó o «Cancelar cita» para liberar el hueco.`,
            desde,
          });
        }
      } else if (!r.payment_deadline) {
        out.push({
          ...base,
          clave: `reserva:${r.id}:sin_plazo`,
          gravedad: "error",
          titulo: "Pendiente de pago sin plazo",
          detalle: `${prueba}La reserva de ${r.client_name} espera un pago pero no tiene plazo: nunca expiraría.`,
          desde: r.created_at,
        });
      } else if (minutosDesde(r.payment_deadline, ahora) > UMBRALES.pagoVencidoMargenMin) {
        out.push({
          ...base,
          clave: `reserva:${r.id}:vencida`,
          gravedad: "error",
          titulo: "Plazo de pago vencido sin cerrar",
          detalle: `${prueba}La reserva de ${r.client_name} debía expirar hace ${duracion(
            minutosDesde(r.payment_deadline, ahora),
          )} y sigue pendiente. El evento provisional del calendario podría seguir ocupando el hueco.`,
          desde: r.payment_deadline,
        });
      }
    } else if (r.status === "pagada" && !r.calendar_event_id) {
      out.push({
        ...base,
        clave: `reserva:${r.id}:sin_evento`,
        gravedad: "error",
        titulo: "Pagada sin evento en el calendario",
        detalle: `${prueba}${r.client_name} ha pagado pero la reserva no tiene evento de calendario asociado.`,
        desde: r.approved_at ?? r.created_at,
      });
    }
  }
  return ordenar(out);
}

export function problemasDeTareas(rows: TareaRow[], ahora: Date): Problema[] {
  const out: Problema[] = [];
  for (const t of rows) {
    const nombre = TIPOS_TAREA[t.kind] ?? t.kind;
    if (t.status === "fallido") {
      out.push({
        clave: `tarea:${t.id}:fallida`,
        gravedad: "error",
        titulo: `Tarea fallida: ${nombre}`,
        detalle: `${t.attempts} intento(s). ${t.last_error ? recortar(t.last_error, 200) : "Sin detalle del error."}`,
        desde: t.run_at,
      });
    } else if (
      t.status === "en_curso" &&
      t.locked_at &&
      minutosDesde(t.locked_at, ahora) > UMBRALES.tareaAtascadaMin
    ) {
      out.push({
        clave: `tarea:${t.id}:atascada`,
        gravedad: "aviso",
        titulo: `Tarea atascada: ${nombre}`,
        detalle: `Lleva ${duracion(minutosDesde(t.locked_at, ahora))} en curso sin terminar.`,
        desde: t.locked_at,
      });
    } else if (t.status === "pendiente" && minutosDesde(t.run_at, ahora) > UMBRALES.tareaVencidaMin) {
      out.push({
        clave: `tarea:${t.id}:vencida`,
        gravedad: "error",
        titulo: `Tarea vencida sin ejecutar: ${nombre}`,
        detalle: `Tenía que ejecutarse hace ${duracion(minutosDesde(t.run_at, ahora))}. Puede que el temporizador (cron) no esté funcionando.`,
        desde: t.run_at,
      });
    }
  }
  return ordenar(out);
}

export type WebhookInfoLite = {
  registrado: boolean;
  pendientes: number;
  ultimoError: string | null;
  /** Cuándo falló Telegram por última vez (ISO). Telegram lo conserva aunque ya se haya recuperado. */
  ultimoErrorFecha: string | null;
};

/** Webhooks perdidos: avisos de Telegram que no han llegado a Kira. */
export function problemasDeWebhook(info: WebhookInfoLite, ahora: Date): Problema[] {
  const out: Problema[] = [];
  const desde = ahora.toISOString();
  if (!info.registrado) {
    out.push({
      clave: "webhook:no_registrado",
      gravedad: "error",
      titulo: "Webhook de Telegram no registrado",
      detalle: "Telegram no sabe a dónde enviar tus mensajes y botones. Hay que volver a registrarlo (/api/setup).",
      desde,
    });
  }
  if (info.pendientes > 0) {
    out.push({
      clave: "webhook:pendientes",
      gravedad: "aviso",
      titulo: `${info.pendientes} aviso(s) de Telegram sin entregar`,
      detalle: "Telegram los tiene en cola porque Kira no los ha aceptado todavía.",
      desde,
    });
  }
  if (info.ultimoErrorFecha && minutosDesde(info.ultimoErrorFecha, ahora) < 24 * 60) {
    out.push({
      clave: "webhook:error_reciente",
      gravedad: "error",
      titulo: "Telegram no pudo entregar un aviso en las últimas 24 h",
      detalle: recortar(info.ultimoError ?? "Sin detalle.", 200),
      desde: info.ultimoErrorFecha,
    });
  }
  return ordenar(out);
}

/** Errores antes que avisos; dentro de cada grupo, lo más antiguo primero. */
export function ordenar(ps: Problema[]): Problema[] {
  const peso = (p: Problema) => (p.gravedad === "error" ? 0 : 1);
  return [...ps].sort((a, b) => peso(a) - peso(b) || Date.parse(a.desde) - Date.parse(b.desde));
}

// ---------------------------------------------------------------------------
// Seguridad
// ---------------------------------------------------------------------------

/** Cuenta eventos por tipo dentro de las últimas `horas` horas. */
export function contarPorTipo(
  rows: { kind: string; at: string }[],
  ahora: Date,
  horas: number,
): Record<string, number> {
  const desde = ahora.getTime() - horas * 3_600_000;
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (Date.parse(r.at) >= desde) out[r.kind] = (out[r.kind] ?? 0) + 1;
  }
  return out;
}

export function resumirDetalle(detail: unknown, max = 300): string {
  if (detail == null) return "";
  let texto: string;
  try {
    texto = JSON.stringify(detail);
  } catch {
    return "";
  }
  return !texto || texto === "{}" ? "" : recortar(texto, max);
}

// ---------------------------------------------------------------------------
// Proceso: línea de tiempo de una conversación
// ---------------------------------------------------------------------------

export type ItemLinea = {
  at: string;
  tipo: "entrada" | "salida" | "evento" | "reserva";
  titulo: string;
  texto?: string;
  nivel?: "info" | "warn" | "error";
  /** Mensaje marcado como posible manipulación. */
  marcado?: boolean;
};

export function euros(centimos: number | null | undefined): string {
  return dinero(centimos, "EUR");
}

export function lineaDeTiempo(
  mensajes: { created_at: string; direction: string; body: string; flagged: boolean }[],
  eventos: { at: string; source: string; kind: string; level: string; summary: string }[],
  reservas: {
    created_at: string;
    status: string;
    service_description: string;
    price_cents: number | null;
    deposit_cents: number | null;
    /** Lo guardado de la propuesta: dice de qué ciudad es (y por tanto en qué moneda están los importes). */
    spec?: unknown;
  }[],
): ItemLinea[] {
  const items: ItemLinea[] = [
    ...mensajes.map((m): ItemLinea => ({
      at: m.created_at,
      tipo: m.direction === "in" ? "entrada" : "salida",
      titulo: m.direction === "in" ? "Mensaje del cliente" : "Respuesta enviada",
      texto: m.body,
      marcado: m.flagged,
    })),
    ...eventos.map((e): ItemLinea => ({
      at: e.at,
      tipo: "evento",
      titulo: `${e.source} · ${e.kind}`,
      texto: e.summary,
      nivel: e.level as ItemLinea["nivel"],
    })),
    ...reservas.map((r): ItemLinea => ({
      at: r.created_at,
      tipo: "reserva",
      titulo: `Reserva: ${ESTADOS_RESERVA[r.status] ?? r.status}`,
      texto: `${r.service_description} · precio ${dinero(r.price_cents, monedaDeSpec(r.spec))} · señal ${dinero(r.deposit_cents, monedaDeSpec(r.spec))}`,
    })),
  ];
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// ---------------------------------------------------------------------------
// Mapeo: lo que Kira entendió y cómo se calculó el precio (lectura defensiva de lo guardado)
// ---------------------------------------------------------------------------

export type Fila = { etiqueta: string; valor: string };

/** Moneda y zona horaria de una propuesta según lo guardado (sin dato = España y euros). */
export const monedaDeSpec = (spec: unknown): Moneda => CONFIG_UBICACION[interpretarUbicacion((spec as { ubicacion?: unknown } | null)?.ubicacion)].moneda;
export const zonaDeSpec = (spec: unknown): string => CONFIG_UBICACION[interpretarUbicacion((spec as { ubicacion?: unknown } | null)?.ubicacion)].zonaHoraria;

const NO_INDICADO = "no indicado";
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? recortar(v.trim(), 300) : null);
const numr = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

const LARGOS_PELO: Record<string, string> = {
  muy_corto: "muy corto", corto: "corto", nuca_hombros: "nuca u hombros", media_espalda: "media espalda", caderas: "caderas", mas_largo: "más largo que las caderas",
};
const LARGOS_TRENZAS: Record<string, string> = {
  nuca: "nuca", hombros: "hombros", media_espalda: "media espalda", caderas: "caderas", mas_largo: "más largo que las caderas",
};

/** Lo que Kira entendió del mensaje del cliente, fila a fila. Acepta cualquier cosa guardada sin romperse. */
export function filasDeMapeo(spec: unknown): Fila[] {
  const s = obj(spec);
  const v = obj(s.servicio);
  const dato = (x: unknown, mapa?: Record<string, string>) => {
    const t = txt(x);
    return t ? (mapa?.[t] ?? t) : NO_INDICADO;
  };
  const ext = txt(v.extensiones);
  const lugar = CONFIG_UBICACION[interpretarUbicacion(s.ubicacion)];
  const filas: Fila[] = [
    { etiqueta: "Ubicación", valor: `${lugar.nombre} (${lugar.moneda === "USD" ? "dólares, hora de Miami" : "euros, hora de Madrid"})` },
    { etiqueta: "Mensaje del cliente", valor: txt(s.mensaje_cliente) ?? "—" },
    { etiqueta: "Tipo de trenzado", valor: dato(v.tipo_trenzado) },
    { etiqueta: "Número de trenzas", valor: numr(v.numero_trenzas) !== null ? String(numr(v.numero_trenzas)) : NO_INDICADO },
    { etiqueta: "Tamaño", valor: dato(v.tamano) },
    { etiqueta: "Estilo (pegadas)", valor: dato(v.estilo_pegadas) },
    { etiqueta: "Extensiones", valor: ext === "con" ? "con" : ext === "feedin" ? "con (feed-in)" : ext === "sin" ? "sin" : NO_INDICADO },
    { etiqueta: "Color de extensiones", valor: dato(s.color_extensiones) },
    { etiqueta: "Boho", valor: v.boho === true ? "sí" : v.boho === false ? "no" : NO_INDICADO },
    { etiqueta: "Largo del pelo", valor: dato(v.largo_cabello, LARGOS_PELO) },
    { etiqueta: "Largo de las trenzas", valor: dato(v.largo_extensiones, LARGOS_TRENZAS) },
    { etiqueta: "Dirección del evento", valor: dato(s.direccion) },
    { etiqueta: "Fecha y hora pedidas", valor: txt(s.fecha) ? `${txt(s.fecha)}${txt(s.hora) ? ` ${txt(s.hora)}` : ""}` : NO_INDICADO },
    { etiqueta: "Nombre", valor: dato(s.nombre) },
    { etiqueta: "Email", valor: dato(s.email) },
    { etiqueta: "Instagram", valor: dato(s.instagram) },
    { etiqueta: "Seguridad del clasificador", valor: dato(s.confianza) },
  ];
  if (s.clasificador === "claude") filas.push({ etiqueta: "Quién lo interpretó", valor: "Claude" });
  if (s.clasificador === "basica") filas.push({ etiqueta: "Quién lo interpretó", valor: "Lectura básica por reglas (sin Claude)" });
  if (numr(s.horas) !== null) filas.push({ etiqueta: "Horas fijadas por ti", valor: `${horasTexto(numr(s.horas)!)} h` });
  if (numr(s.precio_manual_centimos) !== null) filas.push({ etiqueta: "Precio puesto por ti", valor: dinero(numr(s.precio_manual_centimos), lugar.moneda) });
  return filas;
}

const ORIGENES_PRECIO: Record<string, string> = {
  legacy: "Calculado por Legacy",
  manual: "Puesto por ti",
  sin_calcular: "Sin calcular (faltan datos)",
  error: "Error al consultar Legacy",
};

/** Cómo se llegó al precio: origen, perfil usado y datos de Legacy. La moneda es la guardada con el precio (sin dato, euros). */
export function filasDePrecio(pricing: unknown): Fila[] {
  const p = obj(pricing);
  const origen = txt(p.origen);
  if (!origen) return [];
  // La moneda guardada con el precio; si falta, la del país del perfil usado (EE. UU. = dólares). Sin nada, euros.
  const moneda: Moneda = p.moneda === "USD" || (p.moneda === undefined && obj(p.perfil).pais === "us") ? "USD" : "EUR";
  const sim = SIMBOLO[moneda];
  const perfil = obj(p.perfil);
  const legacy = obj(p.legacy);
  const filas: Fila[] = [{ etiqueta: "Origen del precio", valor: ORIGENES_PRECIO[origen] ?? origen }];
  if (numr(p.horas) !== null) filas.push({ etiqueta: "Horas usadas", valor: `${horasTexto(numr(p.horas)!)} h` });
  if (numr(p.materiales) !== null) filas.push({ etiqueta: "Materiales", valor: `${numr(p.materiales)} ${sim}` });
  if (txt(perfil.nivel)) {
    filas.push({
      etiqueta: "Perfil usado",
      valor: `${txt(perfil.nivel)} · zona ${txt(perfil.zona) ?? "?"} · ${txt(perfil.estructura) ?? "?"} · base salarial ${numr(perfil.smi) ?? "?"} ${sim}${perfil.confirmado === true ? "" : " (sin confirmar)"}`,
    });
  }
  if (numr(legacy.totalCentimos) !== null) filas.push({ etiqueta: "Total de Legacy", valor: dinero(numr(legacy.totalCentimos), moneda) });
  if (numr(legacy.tarifaHora) !== null) filas.push({ etiqueta: "Tarifa por hora", valor: `${numr(legacy.tarifaHora)} ${sim}/h` });
  if (txt(p.error)) filas.push({ etiqueta: "Error", valor: txt(p.error)! });
  return filas;
}

// ---------------------------------------------------------------------------
// Fechas (hora de Madrid, salvo las citas de Miami, que se enseñan en su hora)
// ---------------------------------------------------------------------------

const ZONA = "Europe/Madrid";
const formatoFechaHora = (zona: string) =>
  new Intl.DateTimeFormat("es-ES", { timeZone: zona, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const fmtFechaHora = formatoFechaHora(ZONA);
const fmtFechaHoraMiami = formatoFechaHora("America/New_York");

const fmtSoloFecha = new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, day: "numeric", month: "long", year: "numeric" });

export function soloFecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : fmtSoloFecha.format(new Date(t));
}

export function fechaHora(iso: string | null | undefined, zona?: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return (zona === "America/New_York" ? fmtFechaHoraMiami : fmtFechaHora).format(new Date(t));
}

export function hace(iso: string | null | undefined, ahora: Date): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const min = (ahora.getTime() - t) / 60_000;
  return min < 1 ? "ahora mismo" : `hace ${duracion(min)}`;
}
