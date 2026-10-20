import { MAX_BYTES_FOTO } from "./fotos";

/**
 * Descarga de las fotos que una clienta manda por Instagram (ManyChat nos pasa una dirección). La dirección viene de fuera, así
 * que no se fía de ella (docs/SEGURIDAD.md):
 *  - solo https y solo dominios de Meta/Instagram/ManyChat (nada de direcciones internas ni de terceros);
 *  - las redirecciones se siguen a mano, con tope, y cada salto se vuelve a comprobar;
 *  - tope de tamaño (el de las fotos) y de tiempo; no se envía ninguna cabecera con claves;
 *  - los errores no llevan la dirección completa (puede llevar un permiso temporal), solo el dominio.
 * El tipo real de imagen lo decide después el guardado de fotos, por los primeros bytes.
 */

const DOMINIOS_PERMITIDOS = ["fbcdn.net", "cdninstagram.com", "fbsbx.com", "manychat.com"];
const MAX_REDIRECCIONES = 3;
const TIMEOUT_MS = 10_000;

export type FetchDescarga = (
  url: string,
  init: { method: "GET"; redirect: "manual"; signal: AbortSignal; headers: Record<string, string> },
) => Promise<{ status: number; headers: { get(n: string): string | null }; body: ReadableStream<Uint8Array> | null }>;

export type ResultadoDescarga =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; motivo: "direccion_no_permitida" | "grande" | "error"; dominio?: string };

/** Solo en las pruebas (KIRA_E2E=1) se admite además el servidor falso local: nunca en producción. */
function hostPermitido(host: string): boolean {
  const h = host.toLowerCase();
  if (process.env.KIRA_E2E === "1" && (h === "127.0.0.1" || h === "localhost")) return true;
  return DOMINIOS_PERMITIDOS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Devuelve la URL si es aceptable, o el dominio (solo el dominio) por el que se rechaza. */
export function comprobarDireccion(texto: string): { ok: true; url: URL } | { ok: false; dominio: string } {
  let u: URL;
  try {
    u = new URL(texto);
  } catch {
    return { ok: false, dominio: "direccion_no_valida" };
  }
  const e2e = process.env.KIRA_E2E === "1";
  const protocoloOk = u.protocol === "https:" || (e2e && u.protocol === "http:");
  if (!protocoloOk || u.username || u.password || !hostPermitido(u.hostname)) return { ok: false, dominio: u.hostname.slice(0, 80) };
  if (!e2e && u.port && u.port !== "443") return { ok: false, dominio: u.hostname.slice(0, 80) };
  return { ok: true, url: u };
}

export async function descargarImagenSegura(
  direccion: string,
  fetchImpl: FetchDescarga = fetch as unknown as FetchDescarga,
  maxBytes: number = MAX_BYTES_FOTO,
): Promise<ResultadoDescarga> {
  let actual = comprobarDireccion(direccion);
  for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
    if (!actual.ok) return { ok: false, motivo: "direccion_no_permitida", dominio: actual.dominio };
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(actual.url.toString(), { method: "GET", redirect: "manual", signal: ctl.signal, headers: { accept: "image/*" } });
      if (res.status >= 300 && res.status < 400) {
        const destino = res.headers.get("location");
        if (!destino) return { ok: false, motivo: "error", dominio: actual.url.hostname };
        actual = comprobarDireccion(new URL(destino, actual.url).toString());
        continue;
      }
      if (res.status !== 200 || !res.body) return { ok: false, motivo: "error", dominio: actual.url.hostname };
      const declarado = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declarado) && declarado > maxBytes) return { ok: false, motivo: "grande", dominio: actual.url.hostname };
      const trozos: Uint8Array[] = [];
      let total = 0;
      const lector = res.body.getReader();
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          await lector.cancel().catch(() => undefined);
          return { ok: false, motivo: "grande", dominio: actual.url.hostname };
        }
        trozos.push(value);
      }
      const bytes = new Uint8Array(total);
      let pos = 0;
      for (const c of trozos) {
        bytes.set(c, pos);
        pos += c.length;
      }
      return { ok: true, bytes };
    } catch {
      return { ok: false, motivo: "error", dominio: actual.ok ? actual.url.hostname : undefined };
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, motivo: "error" };
}
