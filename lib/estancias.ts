import type { Ubicacion } from "./ubicacion";

/**
 * Dónde está Blake cada día. Vive en España y viaja a Miami: avisa de qué fecha a qué fecha y esas fechas quedan para Miami.
 * Fuera de las estancias apuntadas está en España. Es una regla BLANDA (docs/POLITICA.md): la propuesta lo avisa con fuerza
 * pero Blake decide siempre; nada se bloquea por su cuenta.
 *
 * Las fechas son días de calendario (AAAA-MM-DD), ambos extremos incluidos, sin hora ni zona horaria: «del 3 al 20 de
 * noviembre» significa esos días enteros.
 */

export type Estancia = { ubicacion: "miami"; desde: string; hasta: string };

export const MAX_ESTANCIAS = 30;
export const MAX_DIAS_ESTANCIA = 120;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function fechaValida(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const aMs = (f: string) => Date.parse(`${f}T00:00:00Z`);
const aIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const diasEntre = (desde: string, hasta: string) => Math.round((aMs(hasta) - aMs(desde)) / 86_400_000) + 1;
export const sumarDias = (f: string, n: number) => aIso(aMs(f) + n * 86_400_000);

/** «3 nov 2026» */
export function fechaCorta(f: string): string {
  const [y, m, d] = f.split("-").map(Number);
  return `${d} ${MESES[m - 1]} ${y}`;
}

export const describirEstancia = (e: Estancia) => `del ${fechaCorta(e.desde)} al ${fechaCorta(e.hasta)}`;

/** Lee lo guardado sin fiarse: descarta lo que no cuadra, une las que se tocan y las ordena. */
export function interpretarEstancias(raw: unknown): Estancia[] {
  if (!Array.isArray(raw)) return [];
  const validas: Estancia[] = [];
  for (const x of raw) {
    const o = x as { ubicacion?: unknown; desde?: unknown; hasta?: unknown } | null;
    if (!o || o.ubicacion !== "miami" || !fechaValida(o.desde) || !fechaValida(o.hasta)) continue;
    if (o.hasta < o.desde || diasEntre(o.desde, o.hasta) > MAX_DIAS_ESTANCIA) continue;
    validas.push({ ubicacion: "miami", desde: o.desde, hasta: o.hasta });
  }
  return unir(validas).slice(0, MAX_ESTANCIAS);
}

/** Ordena y une las estancias que se solapan o son de días seguidos (del 3 al 10 y del 11 al 20 = del 3 al 20). */
export function unir(lista: Estancia[]): Estancia[] {
  const orden = [...lista].sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0));
  const out: Estancia[] = [];
  for (const e of orden) {
    const ultima = out.at(-1);
    if (ultima && e.desde <= sumarDias(ultima.hasta, 1)) {
      if (e.hasta > ultima.hasta) ultima.hasta = e.hasta;
    } else {
      out.push({ ...e });
    }
  }
  return out;
}

/** Dónde está Blake ese día: Miami si una estancia lo cubre; si no, España. */
export function dondeEstoy(fecha: string, estancias: Estancia[]): Ubicacion {
  return estancias.some((e) => e.desde <= fecha && fecha <= e.hasta) ? "miami" : "espana";
}

/**
 * Aviso para una propuesta cuando la fecha pedida no cuadra con dónde está Blake. null = todo bien o sin fecha.
 * No bloquea nada: decide Blake.
 */
export function avisoDeEstancia(ubicacionClienta: Ubicacion, fecha: string | null | undefined, estancias: Estancia[]): string | null {
  if (!fecha || !fechaValida(fecha)) return null;
  const donde = dondeEstoy(fecha, estancias);
  if (donde === ubicacionClienta) return null;
  if (ubicacionClienta === "miami") {
    const proximas = estancias.filter((e) => e.hasta >= fecha).slice(0, 3);
    if (estancias.length === 0) return "🚫 No tienes ninguna estancia en Miami apuntada: ese día estarías en España. Apunta tus fechas con «/viaje miami 3/11 al 20/11».";
    const lista = (proximas.length ? proximas : estancias.slice(-3)).map(describirEstancia).join("; ");
    return `🚫 Ese día no estás en Miami (tus estancias en Miami: ${lista}).`;
  }
  const e = estancias.find((x) => x.desde <= fecha && fecha <= x.hasta)!;
  return `🚫 Ese día estás en Miami (${describirEstancia(e)}): no estás en España.`;
}
