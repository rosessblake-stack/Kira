import { ZONA_MADRID, partesEn } from "./agenda";
import {
  MAX_DIAS_ESTANCIA,
  MAX_ESTANCIAS,
  describirEstancia,
  diasEntre,
  fechaValida,
  unir,
  type Estancia,
} from "./estancias";
import { limpiarTexto } from "./intents";
import { interpretarFecha } from "./proposal";

/**
 * Los viajes de Blake a Miami, por Telegram:
 *   /viaje miami 3/11 al 20/11     apunta que estás en Miami esos días
 *   /viajes                        lista los que hay (los que ya pasaron no salen)
 *   /borrarviaje 2                 quita el n.º 2 de la lista
 * Solo Blake (administrador) puede usarlos; lo que escribe se interpreta con un formato cerrado, nunca como orden.
 */

export interface TripDeps {
  now(): Date;
  leer(): Promise<Estancia[]>;
  guardar(estancias: Estancia[]): Promise<void>;
  enviar(chatId: number, texto: string): Promise<number | null>;
  logEvent(e: { source: "telegram"; kind: string; level?: "info" | "warn" | "error"; summary: string; detail?: Record<string, unknown> }): Promise<void>;
}

export interface TripPort {
  viaje(chatId: number, texto: string): Promise<void>;
  viajes(chatId: number): Promise<void>;
  borrarViaje(chatId: number, texto: string): Promise<void>;
}

const AYUDA = "Escríbelo así: /viaje miami 3/11 al 20/11 (de qué día a qué día estás en Miami, los dos incluidos).";

/** «3/11», «3-11-2026», «2026-11-03» → partes; el año puede faltar. */
function partesDeFecha(txt: string): { d: number; m: number; anio: number | null } | null {
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(txt);
  if (iso) return { d: Number(iso[3]), m: Number(iso[2]), anio: Number(iso[1]) };
  const dm = /^\s*(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\s*$/.exec(txt);
  if (!dm) return null;
  const anio = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : null;
  return { d: Number(dm[1]), m: Number(dm[2]), anio };
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * «3/11 al 20/11» → {desde, hasta}. El final, sin año, es la próxima vez que llega esa fecha; el principio, sin año, es el
 * mismo año que el final (o el anterior si así quedaría después): así «10/10 al 25/10» vale aunque ya estés en el viaje y
 * «20/12 al 5/1» cruza el fin de año.
 */
export function interpretarRango(txt: string, ahora: Date): { desde: string; hasta: string } | { error: string } {
  const partes = txt.split(/\s+(?:al|hasta|a)\s+|\s*[–—]\s*|\s+-\s+/i).map((s) => s.trim()).filter(Boolean);
  if (partes.length !== 2) return { error: "no veo las dos fechas." };
  const [ini, fin] = partes;
  const pf = partesDeFecha(fin);
  const pi = partesDeFecha(ini);
  if (!pf || !pi) return { error: "no entiendo las fechas." };

  const hasta = pf.anio ? iso(pf.anio, pf.m, pf.d) : interpretarFecha(fin, ahora, ZONA_MADRID);
  if (!hasta || !fechaValida(hasta)) return { error: "la fecha final no existe." };
  const [yh] = hasta.split("-").map(Number);
  let desde = iso(pi.anio ?? yh, pi.m, pi.d);
  if (!fechaValida(desde)) return { error: "la fecha inicial no existe." };
  if (!pi.anio && desde > hasta) desde = iso(yh - 1, pi.m, pi.d);
  if (!fechaValida(desde)) return { error: "la fecha inicial no existe." };
  if (desde > hasta) return { error: "la fecha final es anterior a la inicial." };
  return { desde, hasta };
}

export function crearFlujoViajes(deps: TripDeps): TripPort {
  const hoy = () => partesEn(deps.now(), ZONA_MADRID).fecha;
  /** Las que siguen vigentes o vendrán (las pasadas no se enseñan ni se borran por número). */
  const vigentes = (todas: Estancia[]) => todas.filter((e) => e.hasta >= hoy());

  async function guardarOAvisar(chatId: number, lista: Estancia[]): Promise<boolean> {
    try {
      await deps.guardar(lista);
      return true;
    } catch (e) {
      await deps.logEvent({ source: "telegram", kind: "viaje_guardado_fallo", level: "error", summary: e instanceof Error ? e.message : "error desconocido" });
      await deps.enviar(chatId, "No he podido guardar el viaje (fallo técnico, mira Fallos en el panel). Inténtalo de nuevo en un momento.");
      return false;
    }
  }

  async function viaje(chatId: number, texto: string): Promise<void> {
    const limpio = limpiarTexto(texto, 120);
    const m = /^(miami)\s+(?:del\s+)?(.+)$/i.exec(limpio);
    if (!m) {
      await deps.enviar(chatId, `Solo apunto viajes a Miami (fuera de ellos estás en España). ${AYUDA}`);
      return;
    }
    const rango = interpretarRango(m[2], deps.now());
    if ("error" in rango) {
      await deps.enviar(chatId, `No he podido apuntarlo: ${rango.error} ${AYUDA}`);
      return;
    }
    if (rango.hasta < hoy()) {
      await deps.enviar(chatId, `Ese viaje (${describirEstancia({ ubicacion: "miami", ...rango })}) ya ha pasado: no lo apunto.`);
      return;
    }
    if (diasEntre(rango.desde, rango.hasta) > MAX_DIAS_ESTANCIA) {
      await deps.enviar(chatId, `Son más de ${MAX_DIAS_ESTANCIA} días seguidos: si es cierto, apúntalo en dos viajes.`);
      return;
    }
    const antes = await deps.leer();
    const nueva: Estancia = { ubicacion: "miami", ...rango };
    const despues = unir([...antes, nueva]);
    if (despues.length > MAX_ESTANCIAS) {
      await deps.enviar(chatId, `Ya hay ${MAX_ESTANCIAS} viajes apuntados: borra alguno con /borrarviaje.`);
      return;
    }
    if (!(await guardarOAvisar(chatId, despues))) return;
    await deps.logEvent({ source: "telegram", kind: "viaje_apuntado", summary: `Viaje a Miami apuntado: ${describirEstancia(nueva)}`, detail: rango });
    const unida = despues.find((e) => e.desde <= nueva.desde && nueva.hasta <= e.hasta)!;
    await deps.enviar(
      chatId,
      [
        `✅ Apuntado: estás en Miami ${describirEstancia(unida)}.`,
        unida.desde !== nueva.desde || unida.hasta !== nueva.hasta ? "(Se ha unido a un viaje que ya tenías.)" : "",
        "Esos días, las propuestas de España te avisarán y las de Miami no. Fuera de esos días, las de Miami te avisarán.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  async function viajes(chatId: number): Promise<void> {
    let lista: Estancia[];
    try {
      lista = vigentes(await deps.leer());
    } catch (e) {
      await deps.logEvent({ source: "telegram", kind: "viaje_lectura_fallo", level: "error", summary: e instanceof Error ? e.message : "error desconocido" });
      await deps.enviar(chatId, "No he podido leer tus viajes (fallo técnico, mira Fallos en el panel).");
      return;
    }
    if (lista.length === 0) {
      await deps.enviar(chatId, "No tienes ningún viaje a Miami apuntado: estás en España. Apunta uno con /viaje miami 3/11 al 20/11.");
      return;
    }
    await deps.enviar(chatId, ["✈️ Tus viajes a Miami:", ...lista.map((e, i) => `${i + 1}. ${describirEstancia(e)} (${diasEntre(e.desde, e.hasta)} días)`), "", "Para quitar uno: /borrarviaje 1"].join("\n"));
  }

  async function borrarViaje(chatId: number, texto: string): Promise<void> {
    const n = /^\s*(\d{1,3})\s*$/.exec(texto)?.[1];
    if (!n) {
      await deps.enviar(chatId, "Dime el número del viaje, el que ves en /viajes. Por ejemplo: /borrarviaje 1");
      return;
    }
    const todas = await deps.leer();
    const lista = vigentes(todas);
    const elegido = lista[Number(n) - 1];
    if (!elegido) {
      await deps.enviar(chatId, `No hay un viaje n.º ${n}. Mira /viajes.`);
      return;
    }
    const resto = todas.filter((e) => !(e.desde === elegido.desde && e.hasta === elegido.hasta));
    if (!(await guardarOAvisar(chatId, resto))) return;
    await deps.logEvent({ source: "telegram", kind: "viaje_borrado", summary: `Viaje a Miami borrado: ${describirEstancia(elegido)}` });
    await deps.enviar(chatId, `🗑 Quitado: ${describirEstancia(elegido)}. Esos días vuelves a estar en España.`);
  }

  return { viaje, viajes, borrarViaje };
}
