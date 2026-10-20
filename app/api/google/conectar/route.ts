import { NextResponse } from "next/server";
import { leerHost, nombreCookieState, depsGoogleFlujo } from "../../../../lib/google-http";
import { iniciarConexion } from "../../../../lib/google-flujo";
import { requireAdmin } from "../../../../lib/panel-session";

export const dynamic = "force-dynamic";

/**
 * Empieza la conexión con Google Calendar. Solo con la sesión del panel (sin ella redirige al acceso; la cookie del panel es
 * SameSite=Strict, así que una web ajena no puede lanzar esto en nombre de Blake).
 */
export async function GET(req: Request) {
  await requireAdmin();
  const host = leerHost(req);
  const r = await iniciarConexion(host, depsGoogleFlujo());
  if (!r.ok) return new Response(null, { status: 303, headers: { location: "/panel/calendario?e=sin_configurar" } });
  const res = NextResponse.redirect(r.urlGoogle, 303);
  // Lax (no Strict): la cookie tiene que viajar de vuelta cuando Google devuelve a Blake a esta web.
  res.cookies.set(nombreCookieState, r.state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
