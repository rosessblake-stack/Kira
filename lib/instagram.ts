/**
 * Enlaces al perfil de Instagram de una clienta para los avisos a Blake (un toque y está en su perfil). Solo se genera un enlace si el
 * usuario tiene la forma exacta de un usuario de Instagram: nada de lo que escriba una clienta llega a una dirección sin validar.
 */
const USUARIO_RE = /^[A-Za-z0-9._]{1,30}$/;

export function usuarioInstagram(v: string | null | undefined): string | null {
  const t = (v ?? "").trim().replace(/^@/, "");
  return USUARIO_RE.test(t) ? t : null;
}

export const enlaceInstagram = (v: string | null | undefined): string | null => {
  const u = usuarioInstagram(v);
  return u ? `https://instagram.com/${u}` : null;
};

/** Fila de botones de Telegram con «📷 Instagram» (vacía si no hay usuario válido). */
export function botonInstagram(v: string | null | undefined): { text: string; url: string }[] {
  const url = enlaceInstagram(v);
  return url ? [{ text: "📷 Instagram", url }] : [];
}
