import { aUtc, duracionLegible, nombreDia, partesEn, type ReglasAgenda } from "./agenda";
import { evaluarHueco, type EventoAgenda, type Hueco } from "./agenda-eventos";

/**
 * Cuando la hora que pide la clienta choca con otra cita, Blake puede ofrecerle alternativas (decisión de Blake, 21-oct):
 *  - hasta 3 huecos libres ESE MISMO DÍA (los calcula `evaluarHueco`, con la misma duración, el margen y el horario),
 *  - y 1 más: la MISMA HORA en el próximo día libre (sin días libres de Blake, sin choques y con el margen mínimo).
 * La clienta contesta con el número. Todo determinista: ni Claude ni texto libre. Lo que no sea un número exacto pasa a Blake.
 */

/** Opción guardada en la reserva (ISO UTC). */
export type OpcionHueco = { inicio: string; fin: string };

export const MAX_OPCIONES = 4;
const DIA_MS = 86_400_000;
/** Cuántos días hacia delante se busca «la misma hora». */
export const DIAS_BUSQUEDA = 21;
const MARGEN_MIN = 60;

export function calcularOpciones(p: {
  inicio: Date;
  fin: Date;
  hueco: Hueco;
  /** Eventos de la agenda de los próximos días (para buscar «la misma hora» otro día). */
  eventos: EventoAgenda[];
  zona: string;
  reglas: Pick<ReglasAgenda, "diasLibres" | "horario">;
  ahora: Date;
  excluirBookingId?: string | null;
  /** Cuántos «misma hora otro día» se buscan (por defecto 1; con la fecha elegida por la clienta, 3). */
  maxDiasSiguientes?: number;
}): OpcionHueco[] {
  const salida: OpcionHueco[] = [];
  const desdeAhora = (d: Date) => d.getTime() > p.ahora.getTime();
  for (const a of p.hueco.alternativas) {
    if (desdeAhora(a.inicio) && salida.length < MAX_OPCIONES - 1) salida.push({ inicio: a.inicio.toISOString(), fin: a.fin.toISOString() });
  }
  const dur = p.fin.getTime() - p.inicio.getTime();
  const pedido = partesEn(p.inicio, p.zona);
  const maxDias = p.maxDiasSiguientes ?? 1;
  let otrosDias = 0;
  for (let n = 1; n <= DIAS_BUSQUEDA; n++) {
    const fecha = partesEn(new Date(aUtc(pedido.fecha, "12:00", p.zona).getTime() + n * DIA_MS), p.zona);
    if (p.reglas.diasLibres?.includes(fecha.diaSemana)) continue;
    const s = aUtc(fecha.fecha, pedido.hora, p.zona);
    const f = new Date(s.getTime() + dur);
    if (!desdeAhora(s)) continue;
    const h = evaluarHueco(s, f, p.eventos, p.zona, { horario: p.reglas.horario, excluirBookingId: p.excluirBookingId, margenMin: MARGEN_MIN });
    if (h.choques.length) continue;
    if ((h.anterior && h.anterior.margenMin < MARGEN_MIN) || (h.siguiente && h.siguiente.margenMin < MARGEN_MIN)) continue;
    salida.push({ inicio: s.toISOString(), fin: f.toISOString() });
    if (++otrosDias >= maxDias) break;
  }
  return salida.slice(0, MAX_OPCIONES);
}

const ETIQUETAS = ["Primera", "Segunda", "Tercera", "Cuarta"];
const PALABRAS = ["primera", "segunda", "tercera", "cuarta"];
/** Palabras que cuentan como cada opción (ManyChat se queda con los números sueltos, así que se pide la palabra). */
const SINONIMOS: Record<string, number> = { primera: 1, primero: 1, uno: 1, segunda: 2, segundo: 2, dos: 2, tercera: 3, tercero: 3, tres: 3, cuarta: 4, cuarto: 4, cuatro: 4 };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const diaLegible = (d: Date, zona: string) => {
  const p = partesEn(d, zona);
  return `${nombreDia(p.diaSemana)} ${Number(p.fecha.split("-")[2])} de ${MESES[Number(p.fecha.split("-")[1]) - 1]}`;
};

/** La línea de una opción: «jueves 22 de octubre de 12:00 a 15:00». */
export function lineaOpcion(o: OpcionHueco, zona: string): string {
  const i = new Date(o.inicio);
  const f = new Date(o.fin);
  return `${diaLegible(i, zona)} de ${partesEn(i, zona).hora} a ${partesEn(f, zona).hora}`;
}

/** El mensaje que recibe la clienta (plantilla: solo fechas y horas ya calculadas por el código). */
export type MotivoNoDisponible = "ocupado" | "dia_libre" | "fuera_horario";

export function textoOpciones(nombre: string | null, pedida: Date, opciones: OpcionHueco[], zona: string, extra: { motivo?: MotivoNoDisponible; otraFecha?: boolean } = {}): string {
  const saludo = nombre ? `¡Hola, ${nombre}!` : "¡Hola!";
  const duracion = opciones[0] ? duracionLegible(Math.round((Date.parse(opciones[0].fin) - Date.parse(opciones[0].inicio)) / 60_000)) : "";
  return [
    extra.motivo === "dia_libre"
      ? `${saludo} Ese día (${diaLegible(pedida, zona)}) no hago citas 😔`
      : extra.motivo === "fuera_horario"
        ? `${saludo} A esa hora (${diaLegible(pedida, zona)}, ${partesEn(pedida, zona).hora}) no puedo atenderte: mi horario es de 11:00 a 22:00 😔`
        : `${saludo} Justo a esa hora (${diaLegible(pedida, zona)}, ${partesEn(pedida, zona).hora}) ya tengo otra cita 😔`,
    `Estas son las opciones que tengo${duracion ? ` para tu servicio (${duracion})` : ""}:`,
    opciones.map((o, i) => `${ETIQUETAS[i]}: ${lineaOpcion(o, zona)}`).join("\n"),
    `Dime cuál prefieres escribiendo, por ejemplo, «quiero la ${PALABRAS[0]}»${opciones.length > 1 ? ` o «quiero la ${PALABRAS[1]}»` : ""}, y te reservo el hueco 😊${extra.otraFecha ? " Y si ninguna te encaja, dime otro día y hora." : ""}`,
  ].join("\n\n");
}

const RELLENO = new Set(["quiero", "la", "el", "opcion", "opc", "me", "quedo", "con", "elijo", "prefiero", "por", "favor", "gracias", "vale", "ok", "perfecto", "de", "esa", "ese", "esta", "mejor", "dame", "pon", "ponme", "numero", "si", "genial", "reservame", "resérvame", "reserva"]);

/** «primera», «quiero la segunda», «vale, la 2», «2», «opción 2», «2️⃣»: la opción elegida (1-based) o null. Cualquier otra cosa no se interpreta. */
export function interpretarElegida(texto: string, cuantas: number): number | null {
  if (texto.length > 50 || /[?¿]/.test(texto)) return null;
  const t = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[⃣️]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  const elegidas = new Set<number>();
  for (const w of t.split(" ")) {
    if (/^\d$/.test(w)) elegidas.add(Number(w));
    else if (w in SINONIMOS) elegidas.add(SINONIMOS[w]);
    else if (/^(?:opcion|opc)(\d)$/.test(w)) elegidas.add(Number(/(\d)$/.exec(w)![1]));
    else if (!RELLENO.has(w)) return null; // una palabra que no es de elegir: no se adivina, va a Blake
  }
  if (elegidas.size !== 1) return null;
  const n = [...elegidas][0];
  return n >= 1 && n <= cuantas ? n : null;
}
