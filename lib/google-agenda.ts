import type { EventoAgenda } from "./agenda-eventos";
import type { AgendaPort } from "./evento";
import { ClienteCalendario, type NuevoEvento } from "./google-calendar";
import { GoogleError, configGoogle, renovarAcceso, type ConfigGoogle, type FetchGoogle } from "./google-oauth";
import { leerConexion, type ConexionGuardada } from "./google-store";

/**
 * El calendario real de Blake: une la conexión guardada, el acceso a Google y el cliente de Calendar en un AgendaPort.
 * Si Google no está configurado o conectado, TODO lo que necesita el calendario lanza un error claro: nunca se crea nada
 * a medias ni se da un hueco por libre sin haberlo mirado.
 */

export type DepsAgendaGoogle = {
  config(): ConfigGoogle | null;
  leerConexion(): Promise<ConexionGuardada | null>;
  /** Calendario fijado por variable de entorno (GOOGLE_CALENDAR_ID); si no, el guardado al conectar. */
  calendarioForzado(): string | null;
  now(): number;
  fetchImpl?: FetchGoogle;
};

const MARGEN_RENOVAR_MS = 5 * 60_000;

export function depsReales(): DepsAgendaGoogle {
  return {
    config: () => configGoogle(),
    leerConexion,
    calendarioForzado: () => process.env.GOOGLE_CALENDAR_ID?.trim() || null,
    now: () => Date.now(),
  };
}

export function crearAgendaGoogle(d: DepsAgendaGoogle = depsReales()): AgendaPort {
  // Acceso en memoria de esta instancia (dura ~1 h); se descarta si cambia el refresh token (reconexión) o Google dice 401.
  let acceso: { clave: string; token: string; expira: number } | null = null;

  async function accesoValido(cfg: ConfigGoogle, refreshToken: string): Promise<string> {
    const clave = `${cfg.clientId}:${refreshToken.slice(-12)}`;
    if (acceso && acceso.clave === clave && acceso.expira - MARGEN_RENOVAR_MS > d.now()) return acceso.token;
    const r = await renovarAcceso(cfg, refreshToken, d.fetchImpl);
    acceso = { clave, token: r.accessToken, expira: d.now() + r.expiraEnSeg * 1000 };
    return acceso.token;
  }

  async function cliente(): Promise<{ cli: ClienteCalendario; con: ConexionGuardada }> {
    const cfg = d.config();
    if (!cfg) throw new GoogleError("Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Vercel", undefined, true);
    const con = await d.leerConexion();
    if (!con) throw new GoogleError("Google Calendar no está conectado (entra en el panel → Calendario)", undefined, true);
    const cli = new ClienteCalendario({
      calendarId: d.calendarioForzado() ?? con.calendario,
      token: () => accesoValido(cfg, con.refreshToken),
      olvidarToken: () => { acceso = null; },
      fetchImpl: d.fetchImpl,
    });
    return { cli, con };
  }

  return {
    async estado() {
      const cfg = d.config();
      const con = cfg ? await d.leerConexion() : null;
      return { conectado: Boolean(cfg && con), cuenta: con?.email ?? null };
    },

    async eventosEntre(desde: Date, hasta: Date): Promise<EventoAgenda[]> {
      return (await cliente()).cli.listar(desde, hasta);
    },

    async crearProvisional(e: NuevoEvento): Promise<void> {
      await (await cliente()).cli.crear(e);
    },

    async pasarAPagada(eventId, bookingId, o) {
      const { cli, con } = await cliente();
      // A una clienta de verdad se la invita siempre que haya email. En una PRUEBA solo si el email es el de la propia cuenta
      // conectada (Blake): así se puede ver todo el recorrido sin mandar nada a nadie más.
      const propia = Boolean(o.email && con.email && o.email.toLowerCase() === con.email.toLowerCase());
      const invitar = Boolean(o.email) && (!o.esPrueba || propia);
      await cli.pasarAPagada(eventId, bookingId, { email: o.email, invitar, titulo: o.titulo });
      return { invitado: invitar };
    },

    async borrar(eventId, bookingId, o) {
      return (await cliente()).cli.borrar(eventId, bookingId, Boolean(o?.avisarInvitados));
    },
  };
}
