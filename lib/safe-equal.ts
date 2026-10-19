import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Comparación de secretos en tiempo constante.
 * Se comparan los hashes para que la longitud del secreto tampoco se filtre.
 */
export function safeEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
