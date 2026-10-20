import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * Conexión con Google (OAuth) para el calendario de Blake. Solo servidor.
 *
 * Qué se pide a Google: ver y editar los EVENTOS de sus calendarios (`calendar.events`) y su email (para enseñar con qué
 * cuenta está conectado). Nada más: no puede borrar calendarios, ni ver contactos, ni correo.
 *
 * Dónde viven los secretos: el ID y el secreto de cliente, en variables de entorno de Vercel (las pone Blake). El «refresh
 * token» que da Google al conectar se guarda en la base de datos CIFRADO (AES-256-GCM, con una clave derivada de la clave de
 * servidor de Supabase): una copia de la base de datos sola no sirve para usarlo. Nunca se registra ni se muestra.
 */

export const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email"] as const;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Solo las pruebas de extremo a extremo (KIRA_E2E=1) pueden apuntar a otro servidor: en producción el secreto de cliente
 *  y el refresh token nunca pueden acabar enviándose a una dirección distinta de la de Google por un ajuste suelto. */
const e2e = () => process.env.KIRA_E2E === "1";
export const urlAutorizacionBase = () => (e2e() && process.env.GOOGLE_AUTH_URL ? process.env.GOOGLE_AUTH_URL : AUTH_URL);
export const urlTokenBase = () => (e2e() && process.env.GOOGLE_TOKEN_URL ? process.env.GOOGLE_TOKEN_URL : TOKEN_URL);
export const urlRevocarBase = () => (e2e() && process.env.GOOGLE_REVOKE_URL ? process.env.GOOGLE_REVOKE_URL : "https://oauth2.googleapis.com/revoke");
export const urlCalendarioBase = () => (e2e() && process.env.GOOGLE_CALENDAR_API ? process.env.GOOGLE_CALENDAR_API : "https://www.googleapis.com/calendar/v3");

export type ConfigGoogle = { clientId: string; clientSecret: string };

/** ¿Están puestos el ID y el secreto de cliente? (Si falta uno, la conexión no se puede ni empezar.) */
export function configGoogle(env: Record<string, string | undefined> = process.env): ConfigGoogle | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** En producción siempre https; solo las pruebas de extremo a extremo (KIRA_E2E=1) usan http contra localhost. */
export const redirectUri = (host: string) => `${e2e() ? "http" : "https"}://${host}/api/google/callback`;

export function urlDeAutorizacion(cfg: ConfigGoogle, redirect: string, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPES.join(" "),
    // offline + consent: así Google devuelve siempre un refresh token (si no, solo lo da la primera vez).
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${urlAutorizacionBase()}?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// Cifrado del refresh token
// ---------------------------------------------------------------------------

function claveDeCifrado(secreto: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secreto), Buffer.from("kira-google-v1"), Buffer.from("refresh-token"), 32));
}

/** `v1.<iv>.<etiqueta>.<cifrado>` en base64url. Cada cifrado usa un iv nuevo. */
export function cifrar(texto: string, secreto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", claveDeCifrado(secreto), iv);
  const cifrado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), cifrado.toString("base64url")].join(".");
}

/** null si no se puede descifrar (otra clave, texto manipulado o formato desconocido). Nunca lanza. */
export function descifrar(valor: string, secreto: string): string | null {
  try {
    const [v, iv, tag, dato] = valor.split(".");
    if (v !== "v1" || !iv || !tag || !dato) return null;
    const d = createDecipheriv("aes-256-gcm", claveDeCifrado(secreto), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(dato, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Secreto de servidor del que se deriva la clave de cifrado. */
export function secretoDeCifrado(env: Record<string, string | undefined> = process.env): string {
  const s = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY (con ella se cifra la conexión con Google)");
  return s;
}

// ---------------------------------------------------------------------------
// «state» contra CSRF: aleatorio, de un solo uso, y solo su hash se guarda
// ---------------------------------------------------------------------------

export const nuevoState = () => randomBytes(32).toString("base64url");
export const hashState = (state: string) => createHash("sha256").update(state).digest("hex");
export const STATE_VALIDEZ_MIN = 10;

// ---------------------------------------------------------------------------
// Intercambios con Google (los errores nunca llevan códigos, tokens ni secretos)
// ---------------------------------------------------------------------------

export class GoogleError extends Error {
  constructor(
    message: string,
    readonly estado?: number,
    /** La conexión ya no vale (revocada, caducada o clave de cliente cambiada): hay que volver a conectar. */
    readonly desconectado = false,
  ) {
    super(message);
  }
}

export type FetchGoogle = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

const TIMEOUT_MS = 10_000;

async function pedirToken(cuerpo: Record<string, string>, fetchImpl: FetchGoogle): Promise<Record<string, unknown>> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(urlTokenBase(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(cuerpo).toString(),
      signal: ctl.signal,
    });
    const texto = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(texto) as Record<string, unknown>;
    } catch {
      /* respuesta que no es JSON */
    }
    if (!res.ok) {
      const codigo = typeof json.error === "string" ? json.error : "";
      // invalid_grant: el permiso se retiró, caducó o el código ya se usó. Hay que volver a conectar.
      const desconectado = codigo === "invalid_grant" || codigo === "invalid_client" || codigo === "unauthorized_client";
      throw new GoogleError(`Google rechazó la conexión (${res.status}${codigo ? `: ${codigo.replace(/[^a-z_]/g, "").slice(0, 40)}` : ""})`, res.status, desconectado);
    }
    return json;
  } catch (e) {
    if (e instanceof GoogleError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new GoogleError("Google no respondió a tiempo");
    throw new GoogleError("No se pudo conectar con Google");
  } finally {
    clearTimeout(t);
  }
}

/** Email del `id_token` que Google entrega por TLS directamente en este intercambio (no hace falta verificar la firma). */
export function emailDelIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" && payload.email.length <= 254 ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export type Conexion = { refreshToken: string; accessToken: string; expiraEnSeg: number; email: string | null };

/** Cambia el código de autorización (de un solo uso) por los tokens. */
export async function intercambiarCodigo(cfg: ConfigGoogle, code: string, redirect: string, fetchImpl: FetchGoogle = fetch as unknown as FetchGoogle): Promise<Conexion> {
  const j = await pedirToken(
    { grant_type: "authorization_code", code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: redirect },
    fetchImpl,
  );
  const refreshToken = typeof j.refresh_token === "string" ? j.refresh_token : null;
  const accessToken = typeof j.access_token === "string" ? j.access_token : null;
  if (!refreshToken || !accessToken) {
    throw new GoogleError("Google no entregó permiso permanente (vuelve a conectar y acepta todos los permisos)");
  }
  const scope = typeof j.scope === "string" ? j.scope.split(" ") : [];
  if (!scope.includes("https://www.googleapis.com/auth/calendar.events")) {
    throw new GoogleError("Falta el permiso para ver y editar los eventos del calendario (vuelve a conectar y marca esa casilla)");
  }
  return { refreshToken, accessToken, expiraEnSeg: typeof j.expires_in === "number" ? j.expires_in : 3000, email: emailDelIdToken(j.id_token) };
}

/** Pide un token de acceso nuevo con el refresh token guardado. */
export async function renovarAcceso(cfg: ConfigGoogle, refreshToken: string, fetchImpl: FetchGoogle = fetch as unknown as FetchGoogle): Promise<{ accessToken: string; expiraEnSeg: number }> {
  const j = await pedirToken({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret }, fetchImpl);
  if (typeof j.access_token !== "string") throw new GoogleError("Google no devolvió un acceso válido");
  return { accessToken: j.access_token, expiraEnSeg: typeof j.expires_in === "number" ? j.expires_in : 3000 };
}

/** Le dice a Google que ese permiso ya no vale. Mejor esfuerzo: si falla, igualmente se borra la conexión guardada. */
export async function revocarPermiso(refreshToken: string, fetchImpl: FetchGoogle = fetch as unknown as FetchGoogle): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(urlRevocarBase(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
      signal: ctl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
