import { logEvent, logSecurity } from "./db";
import type { DepsGoogleFlujo } from "./google-flujo";
import { configGoogle, intercambiarCodigo } from "./google-oauth";
import { gastarState, guardarConexion, guardarState } from "./google-store";

/** Piezas reales (red, base de datos, cookies) de la conexión con Google, para las rutas /api/google/*. */

const PROD = process.env.NODE_ENV === "production";
/** Cookie del «state». __Host- obliga a Secure, Path=/ y sin Domain. */
export const nombreCookieState = PROD ? "__Host-kira_google" : "kira_google";

/** La dirección por la que Blake entra al panel: Google tiene que devolverle exactamente ahí. */
export function leerHost(req: Request): string {
  const candidato = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  // Solo un nombre de servidor normal (letras, cifras, puntos, guiones y puerto): nada que rompa una URL.
  return /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i.test(candidato) ? candidato : (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "localhost");
}

export function depsGoogleFlujo(): DepsGoogleFlujo {
  return {
    now: () => new Date(),
    config: () => configGoogle(),
    guardarState,
    gastarState,
    intercambiar: (cfg, code, redirect) => intercambiarCodigo(cfg, code, redirect),
    guardarConexion,
    calendarioPorDefecto: () => process.env.GOOGLE_CALENDAR_ID?.trim() || "primary",
    logEvent: ({ source, ...e }) => logEvent(source, e),
    logSecurity,
  };
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Página mínima (sin scripts) con el resultado y un enlace al panel. */
export function paginaResultado(ok: boolean, texto: string): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kira · Google Calendar</title><style>body{font:16px system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1c1c1c}a{display:inline-block;margin-top:1rem;padding:.6rem 1rem;border-radius:.5rem;background:#1c1c1c;color:#fff;text-decoration:none}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}a{background:#eee;color:#111}}</style></head><body><h1>${ok ? "✅ Listo" : "⚠️ No se ha conectado"}</h1><p>${esc(texto)}</p><a href="/panel/calendario">Volver al panel</a></body></html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      "referrer-policy": "no-referrer",
    },
  });
}
