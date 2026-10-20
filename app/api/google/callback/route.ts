import { leerHost, nombreCookieState, depsGoogleFlujo, paginaResultado } from "../../../../lib/google-http";
import { terminarConexion } from "../../../../lib/google-flujo";

export const dynamic = "force-dynamic";

/**
 * Google devuelve aquí a Blake tras aceptar (o no) el permiso. No hay sesión del panel en esta petición (viene de otra web y la
 * cookie del panel es Strict): la protege el «state» de un solo uso, que debe coincidir con la cookie de este navegador.
 * Responde con una página sencilla con un enlace al panel (un enlace, no una redirección, para que llegue ya con su sesión).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cookie = req.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${nombreCookieState}=`))?.slice(nombreCookieState.length + 1) ?? null;
  const r = await terminarConexion(
    leerHost(req),
    { code: url.searchParams.get("code"), state: url.searchParams.get("state"), error: url.searchParams.get("error"), cookieState: cookie },
    depsGoogleFlujo(),
  );
  const res = paginaResultado(r.ok, r.ok ? (r.cuenta ? `Conectado con ${r.cuenta}.` : "Conectado.") : r.mensaje);
  // La cookie del «state» ya cumplió: se borra.
  res.headers.append("set-cookie", `${nombreCookieState}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  return res;
}
