/**
 * Fechas de agenda: cada fecha se interpreta en la hora del lugar donde está la clienta (Madrid o Miami) y se guarda en UTC.
 * Si no se dice otra, la zona es la de Madrid. Las reglas de horario son BLANDAS (docs/POLITICA.md): solo generan avisos,
 * decide siempre Blake.
 */

export const ZONA_MADRID = "Europe/Madrid";
export const ZONA_MIAMI = "America/New_York";

/** Diferencia (ms) entre la hora de pared de esa zona y UTC en ese instante (Madrid: +1 h en invierno, +2 h en verano). */
function desfase(instante: Date, zona: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante);
  const g = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const comoUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/** "2026-10-20" + "12:00" (hora de esa zona) → instante UTC correcto, también en los cambios de hora. */
export function aUtc(fecha: string, hora: string, zona: string = ZONA_MADRID): Date {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  const h = /^(\d{2}):(\d{2})$/.exec(hora);
  if (!f || !h) throw new Error("Fecha u hora con formato no válido");
  const pared = Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]), Number(h[1]), Number(h[2]));
  // Dos pasadas: la primera da una aproximación y la segunda corrige si cruza el cambio de hora.
  let utc = pared - desfase(new Date(pared), zona);
  utc = pared - desfase(new Date(utc), zona);
  return new Date(utc);
}

/** «Hora de Madrid» (el caso de siempre). */
export const madridAUtc = (fecha: string, hora: string) => aUtc(fecha, hora, ZONA_MADRID);

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Partes de la hora de pared de esa zona para un instante. */
export function partesEn(instante: Date, zona: string = ZONA_MADRID): { fecha: string; hora: string; minutosDelDia: number; diaSemana: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(instante);
  const g = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return {
    fecha: `${g("year")}-${g("month")}-${g("day")}`,
    hora: `${g("hour")}:${g("minute")}`,
    minutosDelDia: Number(g("hour")) * 60 + Number(g("minute")),
    diaSemana: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")),
  };
}

export const partesMadrid = (instante: Date) => partesEn(instante, ZONA_MADRID);

/** "mar 20 oct, 12:00" (en la hora de esa zona) */
export function fechaLarga(instante: Date, zona: string = ZONA_MADRID): string {
  const p = partesEn(instante, zona);
  const [, mes, dia] = p.fecha.split("-").map(Number);
  return `${DIAS[p.diaSemana]} ${dia} ${MESES[mes - 1]}, ${p.hora}`;
}

/** "3 h", "1 h 30 min", "45 min" */
export function duracionLegible(minutos: number): string {
  const m = Math.round(minutos);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** Días que Blake no trabaja en España (0 = domingo … 6 = sábado). Decisión de Blake: domingo y lunes. */
export const DIAS_LIBRES: readonly number[] = [0, 1];
const NOMBRE_DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const nombreDia = (diaSemana: number) => NOMBRE_DIA[diaSemana] ?? "?";

export const HORARIO = { aperturaMin: 11 * 60, cierreMin: 22 * 60, inicioTempranoMin: 8 * 60, servicioLargoMin: 6 * 60 } as const;
export type Horario = { aperturaMin: number; cierreMin: number; inicioTempranoMin: number; servicioLargoMin: number };

/**
 * Las reglas blandas de un lugar. `null` = todavía sin definir: no se avisa de nada (Blake aún no ha dicho cuáles son).
 */
export type ReglasAgenda = {
  zona: string;
  diasLibres: readonly number[] | null;
  horario: Horario | null;
};

export const REGLAS_ESPANA: ReglasAgenda = { zona: ZONA_MADRID, diasLibres: DIAS_LIBRES, horario: HORARIO };

export const listaDiasLibres = (reglas: ReglasAgenda = REGLAS_ESPANA) => (reglas.diasLibres ?? []).map(nombreDia).join(" y ");
/** ¿Ese instante cae en un día libre de Blake (en la hora de ese lugar)? */
export const esDiaLibre = (instante: Date, reglas: ReglasAgenda = REGLAS_ESPANA) =>
  Boolean(reglas.diasLibres?.includes(partesEn(instante, reglas.zona).diaSemana));

/**
 * Avisos de horario (blandos). No comprueba huecos: eso exige el calendario real.
 * Devuelve textos listos para mostrar a Blake.
 */
export function avisosDeHorario(inicio: Date | null, fin: Date | null, ahora: Date, reglas: ReglasAgenda = REGLAS_ESPANA): string[] {
  if (!inicio || !fin) return [];
  const out: string[] = [];
  if (inicio.getTime() <= ahora.getTime()) out.push("La fecha pedida ya ha pasado.");
  else if (inicio.getTime() - ahora.getTime() > 400 * 86_400_000) out.push("La fecha pedida está a más de un año vista: revísala.");

  const ini = partesEn(inicio, reglas.zona);
  const fin_ = partesEn(fin, reglas.zona);
  if (reglas.diasLibres?.includes(ini.diaSemana)) {
    out.push(`La cita cae en ${nombreDia(ini.diaSemana)}, que es día libre (no trabajas: ${listaDiasLibres(reglas)}).`);
  }
  const H = reglas.horario;
  if (!H) return out; // horario sin definir (Miami): solo los avisos de fecha
  const duracion = (fin.getTime() - inicio.getTime()) / 60_000;
  const mismoDia = ini.fecha === fin_.fecha;

  if (ini.minutosDelDia < H.aperturaMin) {
    if (duracion > H.servicioLargoMin && ini.minutosDelDia >= H.inicioTempranoMin) {
      /* servicio de más de 6 h: se permite empezar desde las 8:00 */
    } else {
      out.push(`Empieza a las ${ini.hora}, antes del horario habitual (11:00–22:00).`);
    }
  }
  if (!mismoDia || fin_.minutosDelDia > H.cierreMin) {
    out.push(`Termina a las ${fin_.hora}${mismoDia ? "" : " del día siguiente"}, después del horario habitual (hasta las 22:00).`);
  }
  return out;
}
