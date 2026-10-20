import { duracionLegible, partesEn } from "./agenda";
import { limpiarTexto } from "./intents";

/**
 * Eventos del calendario de Blake y comprobación de huecos (docs/SEGURIDAD.md §5). Lógica pura: no habla con Google.
 *
 * Reglas que cumple:
 *  - TODOS los eventos cuentan, también los marcados «libre» (transparentes): una cita de Lux marcada «libre» ya causó un
 *    solape. Tampoco se ignoran los que Blake haya «rechazado» como invitado: siguen siendo una cita suya.
 *  - Se usa la hora de fin real de cada evento.
 *  - Solo se ignoran las pruebas de Kira (/simular) y la propia reserva que se está comprobando.
 *  - Un solape con un evento con hora BLOQUEA (no se crea nada). El margen entre citas y los eventos de todo el día
 *    son avisos: decide Blake.
 */

export type EventoAgenda = {
  id: string;
  titulo: string;
  /** Eventos con hora. */
  inicio: Date | null;
  fin: Date | null;
  /** Eventos de todo el día: fechas AAAA-MM-DD; `hasta` es el primer día que ya NO ocupa (como en Google). */
  dias: { desde: string; hasta: string } | null;
  /** Marcado «libre» en Google (transparente). Cuenta igual. */
  libre: boolean;
  /** Lo creó Kira (lleva su marca privada). */
  esDeKira: boolean;
  /** Lo creó Kira para una prueba (/simular): no bloquea huecos reales. */
  esPrueba: boolean;
  bookingId: string | null;
};

const TITULO_MAX = 80;
const fechaIso = /^\d{4}-\d{2}-\d{2}$/;

type Cru = Record<string, unknown>;
const obj = (v: unknown): Cru | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Cru) : null);
const texto = (v: unknown) => (typeof v === "string" ? v : null);

/** Convierte un evento tal como lo devuelve Google. Devuelve null si está cancelado o no se entiende (no se inventa nada). */
export function interpretarEventoGoogle(raw: unknown): EventoAgenda | null {
  const e = obj(raw);
  if (!e) return null;
  if (e.status === "cancelled") return null;
  const id = texto(e.id);
  if (!id) return null;
  const inicio = obj(e.start);
  const fin = obj(e.end);
  if (!inicio || !fin) return null;

  const priv = obj(obj(e.extendedProperties)?.private);
  const bookingId = texto(priv?.kira_booking_id);
  const base = {
    id,
    titulo: limpiarTexto(texto(e.summary) ?? "(sin título)", TITULO_MAX) || "(sin título)",
    libre: e.transparency === "transparent",
    esDeKira: bookingId !== null,
    esPrueba: priv?.kira_test === "1",
    bookingId,
  };

  const dtIni = texto(inicio.dateTime);
  const dtFin = texto(fin.dateTime);
  if (dtIni && dtFin) {
    const a = new Date(dtIni);
    const b = new Date(dtFin);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    return { ...base, inicio: a, fin: b, dias: null };
  }
  const dIni = texto(inicio.date)?.slice(0, 10);
  const dFin = texto(fin.date)?.slice(0, 10);
  if (dIni && dFin && fechaIso.test(dIni) && fechaIso.test(dFin)) {
    return { ...base, inicio: null, fin: null, dias: { desde: dIni, hasta: dFin > dIni ? dFin : dIni } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Comprobación del hueco
// ---------------------------------------------------------------------------

export const MARGEN_MINIMO_MIN = 60;

export type Contigua = { evento: EventoAgenda; margenMin: number };

export type Hueco = {
  /** Eventos con hora que se solapan con la cita: BLOQUEAN. */
  choques: EventoAgenda[];
  anterior: Contigua | null;
  siguiente: Contigua | null;
  /** Eventos de todo el día que caen en el día de la cita (aviso, no bloquean). */
  todoElDia: EventoAgenda[];
  /** Eventos con hora de ese día (en la hora de la cita), para enseñar la agenda. */
  delDia: EventoAgenda[];
  margenMin: number;
};

export type OpcionesHueco = {
  margenMin?: number;
  /** La reserva que se está comprobando: su propio evento no cuenta como choque. */
  excluirBookingId?: string | null;
};

/** ¿Este evento cuenta para decidir si hay hueco? */
const cuenta = (e: EventoAgenda, excluirBookingId: string | null | undefined) =>
  !e.esPrueba && !(excluirBookingId && e.bookingId === excluirBookingId);

export function evaluarHueco(inicio: Date, fin: Date, eventos: EventoAgenda[], zona: string, opts: OpcionesHueco = {}): Hueco {
  const margen = opts.margenMin ?? MARGEN_MINIMO_MIN;
  const relevantes = eventos.filter((e) => cuenta(e, opts.excluirBookingId));
  const conHora = relevantes.filter((e): e is EventoAgenda & { inicio: Date; fin: Date } => e.inicio !== null && e.fin !== null);

  const choques = conHora
    .filter((e) => (e.fin.getTime() > e.inicio.getTime() ? e.inicio < fin && e.fin > inicio : e.inicio > inicio && e.inicio < fin))
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

  const previos = conHora.filter((e) => e.fin <= inicio && !choques.includes(e)).sort((a, b) => b.fin.getTime() - a.fin.getTime());
  const proximos = conHora.filter((e) => e.inicio >= fin && !choques.includes(e)).sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  const anterior = previos[0] ? { evento: previos[0], margenMin: Math.round((inicio.getTime() - previos[0].fin.getTime()) / 60_000) } : null;
  const siguiente = proximos[0] ? { evento: proximos[0], margenMin: Math.round((proximos[0].inicio.getTime() - fin.getTime()) / 60_000) } : null;

  const dia = partesEn(inicio, zona).fecha;
  const todoElDia = relevantes.filter((e) => e.dias !== null && dia >= e.dias.desde && dia < e.dias.hasta);
  const delDia = conHora
    .filter((e) => partesEn(e.inicio, zona).fecha === dia || (e.inicio < inicio && e.fin > inicio))
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

  return { choques, anterior, siguiente, todoElDia, delDia, margenMin: margen };
}

/** Lo que sabe Kira de la agenda cuando prepara una propuesta. */
export type ResultadoAgenda =
  | { estado: "no_conectado" }
  | { estado: "sin_horario" }
  | { estado: "error"; motivo: string }
  | { estado: "ok"; hueco: Hueco };

const hora = (d: Date, zona: string) => partesEn(d, zona).hora;
const recorte = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1)}…`);

/** ««Trenzas Cata» 11:00–13:00» */
export function describirEvento(e: EventoAgenda, zona: string): string {
  if (e.inicio && e.fin) return `«${recorte(e.titulo, 40)}» ${hora(e.inicio, zona)}–${hora(e.fin, zona)}`;
  return `«${recorte(e.titulo, 40)}» (todo el día)`;
}

/** Lo que bloquea (para `faltan`): una frase por choque. */
export function textoChoques(h: Hueco, zona: string): string[] {
  return h.choques.map((e) => `hueco ocupado por ${describirEvento(e, zona)}${e.libre ? " (marcado «libre» en tu calendario, pero cuenta)" : ""}`);
}

/** Avisos blandos del hueco: margen corto con la cita de antes o de después, y eventos de todo el día. */
export function avisosDeHueco(h: Hueco, zona: string): string[] {
  const out: string[] = [];
  if (h.choques.length === 0) {
    const corto = (c: Contigua | null, cual: string) =>
      c && c.margenMin < h.margenMin
        ? `Margen de ${duracionLegible(Math.max(0, c.margenMin))} con la cita ${cual} (${describirEvento(c.evento, zona)}); lo habitual es ${duracionLegible(h.margenMin)}.`
        : null;
    const a = corto(h.anterior, "anterior");
    const s = corto(h.siguiente, "siguiente");
    if (a) out.push(a);
    if (s) out.push(s);
  }
  for (const e of h.todoElDia) out.push(`Ese día tienes un evento de todo el día: «${recorte(e.titulo, 60)}».`);
  return out;
}

/**
 * La agenda de ese día para Blake: sus eventos con hora, la cita nueva en su sitio y los márgenes con las contiguas.
 * Texto plano; los títulos son de su propio calendario pero se pintan como texto, nunca como formato.
 */
export function textoAgendaDelDia(h: Hueco, inicio: Date, fin: Date, zona: string, fechaTexto: string): string[] {
  const l: string[] = [`📅 Tu agenda ese día (${fechaTexto})`];
  const marca = `${hora(inicio, zona)}–${hora(fin, zona)} ◀ esta cita`;
  type Fila = { t: number; txt: string };
  const filas: Fila[] = h.delDia.map((e) => ({
    t: (e.inicio as Date).getTime(),
    txt: `${hora(e.inicio as Date, zona)}–${hora(e.fin as Date, zona)} ${recorte(e.titulo, 40)}${h.choques.includes(e) ? "  ⛔ CHOCA" : ""}${e.libre ? " (libre)" : ""}`,
  }));
  filas.push({ t: inicio.getTime(), txt: marca });
  filas.sort((a, b) => a.t - b.t);
  // Mucha agenda: se enseña lo cercano a la cita nueva.
  const idx = filas.findIndex((f) => f.txt === marca);
  const desde = Math.max(0, idx - 3);
  const trozo = filas.slice(desde, idx + 4);
  if (desde > 0) l.push("• …");
  for (const f of trozo) l.push(`• ${f.txt}`);
  if (idx + 4 < filas.length) l.push("• …");
  if (h.choques.length === 0) {
    const partes: string[] = [];
    if (h.anterior) partes.push(`con la anterior: ${duracionLegible(Math.max(0, h.anterior.margenMin))}`);
    if (h.siguiente) partes.push(`con la siguiente: ${duracionLegible(Math.max(0, h.siguiente.margenMin))}`);
    if (partes.length) l.push(`Margen ${partes.join(" · ")}`);
    else if (!h.delDia.length) l.push("Sin otras citas ese día.");
  }
  return l;
}
