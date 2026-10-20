import { hashState, STATE_VALIDEZ_MIN, configGoogle, intercambiarCodigo, nuevoState, redirectUri, urlDeAutorizacion, GoogleError, type ConfigGoogle, type Conexion } from "./google-oauth";
import { safeEqual } from "./safe-equal";

/**
 * Los dos pasos de conectar Google Calendar, sin tocar ni la red ni la base de datos (se inyectan), para poder probarlos:
 *   iniciar    el panel manda a Blake a Google; antes se guarda el hash de un «state» de un solo uso (y va igual en una cookie)
 *   terminar   Google devuelve a Blake con un código; solo se acepta si el «state» coincide con la cookie y con el guardado,
 *              no ha caducado y es la primera vez. Entonces se cambia el código por el permiso permanente y se guarda cifrado.
 */

export interface DepsGoogleFlujo {
  now(): Date;
  config(): ConfigGoogle | null;
  guardarState(hash: string, expiraIso: string, ahora: Date): Promise<void>;
  gastarState(hash: string, ahora: Date): Promise<boolean>;
  intercambiar(cfg: ConfigGoogle, code: string, redirect: string): Promise<Conexion>;
  guardarConexion(c: { refreshToken: string; email: string | null; calendario: string }, ahora: Date): Promise<void>;
  calendarioPorDefecto(): string;
  logEvent(e: { source: "calendar"; kind: string; level?: "info" | "warn" | "error"; summary: string; detail?: Record<string, unknown> }): Promise<void>;
  logSecurity(e: { kind: "payload_inesperado"; source: string; detail?: Record<string, unknown> }): Promise<void>;
}

export type ResultadoInicio = { ok: true; urlGoogle: string; state: string } | { ok: false; motivo: "sin_configurar" };

export async function iniciarConexion(host: string, d: DepsGoogleFlujo): Promise<ResultadoInicio> {
  const cfg = d.config();
  if (!cfg) return { ok: false, motivo: "sin_configurar" };
  const ahora = d.now();
  const state = nuevoState();
  await d.guardarState(hashState(state), new Date(ahora.getTime() + STATE_VALIDEZ_MIN * 60_000).toISOString(), ahora);
  return { ok: true, urlGoogle: urlDeAutorizacion(cfg, redirectUri(host), state), state };
}

export type ResultadoFin =
  | { ok: true; cuenta: string | null }
  | { ok: false; motivo: "cancelado" | "state_invalido" | "sin_configurar" | "google_rechazo"; mensaje: string };

const MENSAJES = {
  cancelado: "No se ha conectado: cancelaste el permiso en Google. Puedes volver a intentarlo desde el panel.",
  state_invalido: "Este enlace ya no vale (caducó, ya se usó o no lo empezaste desde tu panel). Vuelve al panel y pulsa «Conectar Google Calendar» otra vez.",
  sin_configurar: "Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Vercel.",
} as const;

export async function terminarConexion(
  host: string,
  p: { code: string | null; state: string | null; error: string | null; cookieState: string | null },
  d: DepsGoogleFlujo,
): Promise<ResultadoFin> {
  const cfg = d.config();
  if (!cfg) return { ok: false, motivo: "sin_configurar", mensaje: MENSAJES.sin_configurar };

  // El «state» de la URL tiene que ser el de la cookie de ESTE navegador y el que se guardó al empezar (una sola vez, sin caducar).
  const invalido = async (razon: string): Promise<ResultadoFin> => {
    await d.logSecurity({ kind: "payload_inesperado", source: "google_callback", detail: { razon } });
    return { ok: false, motivo: "state_invalido", mensaje: MENSAJES.state_invalido };
  };
  if (!p.state || !p.cookieState || !safeEqual(p.state, p.cookieState)) return invalido("state_no_coincide_con_cookie");
  if (!(await d.gastarState(hashState(p.state), d.now()))) return invalido("state_desconocido_caducado_o_usado");

  if (p.error) {
    await d.logEvent({ source: "calendar", kind: "google_conexion_cancelada", level: "warn", summary: "Blake no aceptó el permiso en Google", detail: { error: p.error.replace(/[^a-z_]/g, "").slice(0, 40) } });
    return { ok: false, motivo: "cancelado", mensaje: MENSAJES.cancelado };
  }
  if (!p.code || p.code.length > 2048) return invalido("sin_codigo");

  try {
    const c = await d.intercambiar(cfg, p.code, redirectUri(host));
    await d.guardarConexion({ refreshToken: c.refreshToken, email: c.email, calendario: d.calendarioPorDefecto() }, d.now());
    await d.logEvent({ source: "calendar", kind: "google_conectado", summary: "Google Calendar conectado", detail: { cuenta_conocida: Boolean(c.email) } });
    return { ok: true, cuenta: c.email };
  } catch (e) {
    const mensaje = e instanceof GoogleError ? e.message : "No se pudo completar la conexión con Google";
    await d.logEvent({ source: "calendar", kind: "google_conexion_fallo", level: "error", summary: mensaje });
    return { ok: false, motivo: "google_rechazo", mensaje: `${mensaje}. Vuelve al panel e inténtalo otra vez.` };
  }
}

export { configGoogle };
