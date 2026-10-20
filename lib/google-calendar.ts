import { GoogleError, urlCalendarioBase, type FetchGoogle } from "./google-oauth";
import { interpretarEventoGoogle, type EventoAgenda } from "./agenda-eventos";

/**
 * Cliente mínimo de Google Calendar (API REST v3), sin SDK. Solo servidor.
 * Reglas (docs/SEGURIDAD.md §5): al listar se piden TODOS los eventos (también los marcados «libre»); al crear no se añade
 * Google Meet; solo se modifica o borra un evento si lleva la marca de la reserva de Kira (`kira_booking_id`).
 * Los errores nunca llevan tokens ni el contenido de los eventos.
 */

/** «kira» + el id de la reserva sin guiones: es un identificador válido de evento (letras a–v y cifras) y el mismo siempre. */
export const idDeEvento = (bookingId: string) => `kira${bookingId.replace(/-/g, "").toLowerCase()}`;

export const COLOR_AMARILLO = "5"; // reserva provisional, sin señal
export const COLOR_MORADO = "3"; // reservado y pagado

export type NuevoEvento = {
  /** Identificador fijo (idDeEvento): crear dos veces el mismo evento no lo duplica. */
  id: string;
  bookingId: string;
  titulo: string;
  descripcion: string;
  ubicacion: string | null;
  inicio: Date;
  fin: Date;
  /** Zona horaria de la cita (Madrid o Miami): así Google la enseña en su hora. */
  zona: string;
  /** Evento de una prueba (/simular): lleva marca de prueba y no bloquea huecos reales. */
  prueba: boolean;
};

export type OpcionesCliente = {
  calendarId: string;
  token(): Promise<string>;
  /** Olvida el token en memoria (Google dijo 401: se pedirá otro). */
  olvidarToken(): void;
  fetchImpl?: FetchGoogle;
};

const TIMEOUT_MS = 10_000;
const MAX_PAGINAS = 10;

export class ClienteCalendario {
  private readonly f: FetchGoogle;
  constructor(private readonly o: OpcionesCliente) {
    this.f = o.fetchImpl ?? (fetch as unknown as FetchGoogle);
  }

  private url(ruta: string, q?: Record<string, string>) {
    const u = new URL(`${urlCalendarioBase()}/calendars/${encodeURIComponent(this.o.calendarId)}${ruta}`);
    for (const [k, v] of Object.entries(q ?? {})) u.searchParams.set(k, v);
    return u.toString();
  }

  /** Una petición; si Google contesta 401 se renueva el acceso y se repite UNA vez. */
  private async llamar(metodo: string, url: string, cuerpo?: unknown, reintento = true): Promise<{ status: number; json: Record<string, unknown> }> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await this.f(url, {
        method: metodo,
        headers: { authorization: `Bearer ${await this.o.token()}`, ...(cuerpo !== undefined ? { "content-type": "application/json" } : {}) },
        ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
        signal: ctl.signal,
      });
      const texto = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
      } catch {
        /* respuesta que no es JSON */
      }
      if (res.status === 401 && reintento) {
        this.o.olvidarToken();
        return this.llamar(metodo, url, cuerpo, false);
      }
      return { status: res.status, json };
    } catch (e) {
      if (e instanceof GoogleError) throw e;
      if (e instanceof Error && e.name === "AbortError") throw new GoogleError("Google Calendar no respondió a tiempo");
      throw new GoogleError("No se pudo conectar con Google Calendar");
    } finally {
      clearTimeout(t);
    }
  }

  private fallo(accion: string, status: number, json: Record<string, unknown>): GoogleError {
    const err = json.error as { status?: unknown; errors?: { reason?: unknown }[] } | undefined;
    const motivo = typeof err?.errors?.[0]?.reason === "string" ? err.errors[0].reason : typeof err?.status === "string" ? err.status : "";
    const limpio = motivo.replace(/[^A-Za-z_]/g, "").slice(0, 40);
    // 401/403 con permisos retirados: hay que volver a conectar.
    return new GoogleError(`Google Calendar respondió ${status} al ${accion}${limpio ? ` (${limpio})` : ""}`, status, status === 401);
  }

  /** TODOS los eventos entre dos instantes (recurrentes ya expandidos), con y sin «libre». */
  async listar(desde: Date, hasta: Date): Promise<EventoAgenda[]> {
    const out: EventoAgenda[] = [];
    let pagina: string | undefined;
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const { status, json } = await this.llamar(
        "GET",
        this.url("/events", {
          timeMin: desde.toISOString(),
          timeMax: hasta.toISOString(),
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: "250",
          showDeleted: "false",
          // Solo lo necesario para decidir el hueco: ni descripciones ni invitados pasan por Kira.
          fields: "nextPageToken,items(id,status,summary,start,end,transparency,extendedProperties/private)",
          ...(pagina ? { pageToken: pagina } : {}),
        }),
      );
      if (status !== 200) throw this.fallo("leer la agenda", status, json);
      const items = Array.isArray(json.items) ? json.items : [];
      for (const it of items) {
        const e = interpretarEventoGoogle(it);
        if (e) out.push(e);
      }
      pagina = typeof json.nextPageToken === "string" ? json.nextPageToken : undefined;
      if (!pagina) return out;
    }
    // Más de 2500 eventos en la ventana: no se puede asegurar que no falte ninguno. Mejor no comprobar que comprobar a medias.
    throw new GoogleError("La agenda tiene demasiados eventos en esa ventana para comprobarla entera");
  }

  private async leerMarca(id: string): Promise<{ existe: boolean; cancelado: boolean; bookingId: string | null }> {
    const { status, json } = await this.llamar("GET", this.url(`/events/${encodeURIComponent(id)}`, { fields: "id,status,extendedProperties/private" }));
    if (status === 404 || status === 410) return { existe: false, cancelado: true, bookingId: null };
    if (status !== 200) throw this.fallo("leer el evento", status, json);
    const priv = (json.extendedProperties as { private?: Record<string, unknown> } | undefined)?.private;
    return { existe: true, cancelado: json.status === "cancelled", bookingId: typeof priv?.kira_booking_id === "string" ? priv.kira_booking_id : null };
  }

  /** Crea el evento PROVISIONAL (amarillo, sin invitados, sin Meet). Si ya existe el de esta misma reserva, no lo duplica. */
  async crear(e: NuevoEvento): Promise<void> {
    const cuerpo = {
      id: e.id,
      summary: e.titulo,
      description: e.descripcion,
      ...(e.ubicacion ? { location: e.ubicacion } : {}),
      start: { dateTime: e.inicio.toISOString(), timeZone: e.zona },
      end: { dateTime: e.fin.toISOString(), timeZone: e.zona },
      colorId: COLOR_AMARILLO,
      // Ocupado: nunca «libre». Es la cita de una persona.
      transparency: "opaque",
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
      extendedProperties: { private: { kira_booking_id: e.bookingId, ...(e.prueba ? { kira_test: "1" } : {}) } },
    };
    // Sin conferenceDataVersion: no se añade Google Meet (las citas son presenciales). sendUpdates=none: no se avisa a nadie.
    const { status, json } = await this.llamar("POST", this.url("/events", { sendUpdates: "none" }), cuerpo);
    if (status === 200 || status === 201) return;
    if (status === 409) {
      // Ya existe un evento con ese identificador: vale solo si es el de esta misma reserva y sigue vivo.
      const m = await this.leerMarca(e.id);
      if (m.existe && !m.cancelado && m.bookingId === e.bookingId) return;
      throw new GoogleError("Ya existe un evento con el identificador de esta reserva y no se puede reutilizar");
    }
    throw this.fallo("crear el evento", status, json);
  }

  /** Reserva pagada: pasa a morado y, si se pide, se añade el email de la clienta (Google le envía la invitación). */
  async pasarAPagada(id: string, bookingId: string, o: { email: string | null; invitar: boolean }): Promise<void> {
    const m = await this.leerMarca(id);
    if (!m.existe || m.cancelado) throw new GoogleError("El evento ya no existe en tu calendario");
    if (m.bookingId !== bookingId) throw new GoogleError("Ese evento no es de Kira: no se toca");
    const cuerpo: Record<string, unknown> = { colorId: COLOR_MORADO };
    if (o.invitar && o.email) cuerpo.attendees = [{ email: o.email }];
    const { status, json } = await this.llamar("PATCH", this.url(`/events/${encodeURIComponent(id)}`, { sendUpdates: o.invitar && o.email ? "all" : "none" }), cuerpo);
    if (status !== 200) throw this.fallo("actualizar el evento", status, json);
  }

  /** Borra SOLO un evento que lleve la marca de esta reserva. Si ya no existe, no es un error. */
  async borrar(id: string, bookingId: string): Promise<"borrado" | "ya_no_existe"> {
    const m = await this.leerMarca(id);
    if (!m.existe || m.cancelado) return "ya_no_existe";
    if (m.bookingId !== bookingId) throw new GoogleError("Ese evento no es de Kira: no se borra");
    const { status, json } = await this.llamar("DELETE", this.url(`/events/${encodeURIComponent(id)}`, { sendUpdates: "none" }));
    if (status === 200 || status === 204) return "borrado";
    if (status === 404 || status === 410) return "ya_no_existe";
    throw this.fallo("borrar el evento", status, json);
  }
}
