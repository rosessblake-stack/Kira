/**
 * Reglas puras del panel: en qué paso está cada conversación, qué cuenta como
 * fallo y cómo se muestran fechas. Sin acceso a datos, para poder probarlas.
 */

export const UMBRALES = {
  /** Una propuesta sin tu Aprobar durante más de esto es un aviso. */
  propuestaSinAprobarMin: 30,
  /** Margen tras el plazo de pago para que el temporizador (cron cada minuto) actúe. */
  pagoVencidoMargenMin: 2,
  /** Aprobada pero sin enlace de pago pasado este tiempo. */
  aprobadaSinEnlaceMin: 5,
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
    if (r.status === "propuesta") {
      const min = minutosDesde(r.created_at, ahora);
      if (min > UMBRALES.propuestaSinAprobarMin) {
        out.push({
          ...base,
          clave: `reserva:${r.id}:propuesta`,
          gravedad: "aviso",
          titulo: "Propuesta sin aprobar",
          detalle: `La propuesta para ${r.client_name} lleva ${duracion(min)} esperando tu decisión.`,
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
          detalle: `La reserva de ${r.client_name} se aprobó hace ${duracion(min)} y no ha pasado a pendiente de pago.`,
          desde,
        });
      }
    } else if (r.status === "pendiente_pago") {
      if (!r.payment_deadline) {
        out.push({
          ...base,
          clave: `reserva:${r.id}:sin_plazo`,
          gravedad: "error",
          titulo: "Pendiente de pago sin plazo",
          detalle: `La reserva de ${r.client_name} espera un pago pero no tiene plazo: nunca expiraría.`,
          desde: r.created_at,
        });
      } else if (minutosDesde(r.payment_deadline, ahora) > UMBRALES.pagoVencidoMargenMin) {
        out.push({
          ...base,
          clave: `reserva:${r.id}:vencida`,
          gravedad: "error",
          titulo: "Plazo de pago vencido sin cerrar",
          detalle: `La reserva de ${r.client_name} debía expirar hace ${duracion(
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
        detalle: `${r.client_name} ha pagado pero la reserva no tiene evento de calendario asociado.`,
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
// Fechas (siempre hora de Madrid)
// ---------------------------------------------------------------------------

const ZONA = "Europe/Madrid";
const fmtFechaHora = new Intl.DateTimeFormat("es-ES", {
  timeZone: ZONA,
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : fmtFechaHora.format(new Date(t));
}

export function hace(iso: string | null | undefined, ahora: Date): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const min = (ahora.getTime() - t) / 60_000;
  return min < 1 ? "ahora mismo" : `hace ${duracion(min)}`;
}
