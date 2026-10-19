import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logSecurity } from "./db";
import { endSession, isValidSession, type Session } from "./panel-auth";
import { authStore } from "./panel-store";

const PROD = process.env.NODE_ENV === "production";
/** El prefijo __Host- obliga a Secure, Path=/ y sin Domain: la cookie no se comparte con subdominios. */
export const COOKIE_NAME = PROD ? "__Host-kira_panel" : "kira_panel";

/**
 * Prueba de que quien llama ya pasó por requireAdmin(). Las funciones que leen
 * datos del panel la exigen como argumento: sin ella no compilan.
 */
export type Admin = { readonly esAdmin: true };
const ADMIN: Admin = Object.freeze({ esAdmin: true as const });

/** Una sola comprobación por petición, aunque la pidan el layout y la página. */
const estadoSesion = cache(async (): Promise<"ok" | "sin_cookie" | "invalida"> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return "sin_cookie";
  if (await isValidSession(authStore, token)) return "ok";
  await logSecurity({
    kind: "acceso_panel_denegado",
    source: "panel",
    detail: { reason: "sesion_invalida" },
  });
  return "invalida";
});

export async function requireAdmin(): Promise<Admin> {
  if ((await estadoSesion()) === "ok") return ADMIN;
  redirect("/panel/entrar");
}

export async function iniciarSesion(session: Session): Promise<void> {
  (await cookies()).set(COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: PROD,
    sameSite: "strict",
    path: "/",
    expires: session.expires,
  });
}

export async function cerrarSesionActual(): Promise<void> {
  const jar = await cookies();
  await endSession(authStore, jar.get(COOKIE_NAME)?.value);
  jar.delete(COOKIE_NAME);
}
