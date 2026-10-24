import { partesEn } from "./agenda";

/**
 * Lee «el 30 de octubre a las 12», «viernes a las 5», «mañana 11:30», «30/10 17h»… SIN Claude (ahorro de tokens, decisión de Blake).
 * Es deliberadamente prudente: solo devuelve algo cuando hay UNA fecha y UNA hora claras. Ante cualquier duda (dos fechas, un número
 * suelto, «por la tarde» sin hora, «la semana que viene»…) devuelve null y quien llama recurre a Claude para ese texto concreto.
 */

export type FechaHora = { fecha: string; hora: string; avisos: string[] };

const MESES: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, sep: 9, sept: 9, octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12,
};
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const MES_RE = Object.keys(MESES).sort((a, b) => b.length - a.length).join("|");
const DIA_RE = DIAS_SEMANA.join("|");

const normalizar = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9:/.\- ]+/g, " ").replace(/\s+/g, " ").trim();

const dosCifras = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${dosCifras(m)}-${dosCifras(d)}`;

function fechaExiste(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const diaSemana = (f: string) => new Date(`${f}T00:00:00Z`).getUTCDay();

type Hora = { h: number; m: number; explicita: boolean; aviso?: string };

function leerHoras(t: string): { horas: Hora[]; resto: string } | null {
  const horas: Hora[] = [];
  let resto = t;
  const quita = (re: RegExp, f: (m: RegExpExecArray) => Hora | null): boolean => {
    for (const m of [...resto.matchAll(re)]) {
      const h = f(m as RegExpExecArray);
      if (!h) return false;
      horas.push(h);
    }
    resto = resto.replace(re, " ");
    return true;
  };
  const tarde = /\bde la (tarde|noche)\b/.test(resto);
  const manana = /\bde la manana\b/.test(resto);
  resto = resto.replace(/\bde la (tarde|noche|manana)\b/g, " ");

  // 17:30, 5:30pm
  if (!quita(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/g, (m) => {
    let h = Number(m[1]);
    const mm = Number(m[2]);
    if (h > 23 || mm > 59) return null;
    if (m[3] === "pm" && h < 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
    return { h, m: mm, explicita: true };
  })) return null;
  // 17h, 17h30
  if (!quita(/\b(\d{1,2})h(\d{2})?\b/g, (m) => {
    const h = Number(m[1]);
    const mm = m[2] ? Number(m[2]) : 0;
    return h > 23 || mm > 59 ? null : { h, m: mm, explicita: true };
  })) return null;
  // 5pm, 12 am
  if (!quita(/\b(\d{1,2})\s*(am|pm)\b/g, (m) => {
    let h = Number(m[1]);
    if (h < 1 || h > 12) return null;
    if (m[2] === "pm" && h < 12) h += 12;
    if (m[2] === "am" && h === 12) h = 0;
    return { h, m: 0, explicita: true };
  })) return null;
  // mediodía
  if (/\bmediodia\b/.test(resto)) {
    horas.push({ h: 12, m: 0, explicita: true });
    resto = resto.replace(/\bmediodia\b/g, " ");
  }
  // «a las 5», «a las 5 y media», «a la 1»
  if (!quita(/\ba las? (\d{1,2})(?: y (media|cuarto))?\b/g, (m) => {
    let h = Number(m[1]);
    const mm = m[2] === "media" ? 30 : m[2] === "cuarto" ? 15 : 0;
    if (h < 1 || h > 23) return null;
    if (tarde && h < 12) return { h: h + 12, m: mm, explicita: true };
    if (manana || h >= 11) return { h, m: mm, explicita: h >= 13 || manana || tarde };
    // 1–8 sin más: nadie pide a esa hora de la mañana, se toma como tarde (y se avisa).
    // 9–10 sin más: se respeta tal cual (las 10 son las 10 de la mañana, fuera del horario del salón: se ofrecerán otras horas).
    if (h <= 8) h += 12;
    return { h, m: mm, explicita: false, aviso: `Hora: «a las ${m[1]}» se ha tomado como ${dosCifras(h)}:${dosCifras(mm)}.` };
  })) return null;
  return { horas, resto };
}

/** `zona` decide cómo se leen las fechas con barra: en España día/mes; en Miami mes/día (y si es ambiguo, no se arriesga). */
export function leerFechaHora(textoBruto: string, ahora: Date, zona: string): FechaHora | null {
  const t = normalizar(textoBruto);
  if (!t || t.length > 200) return null;

  const h = leerHoras(t);
  if (!h) return null;
  const valores = new Set(h.horas.map((x) => `${dosCifras(x.h)}:${dosCifras(x.m)}`));
  if (valores.size !== 1) return null;
  const hora = [...valores][0];
  const avisos = h.horas.every((x) => !x.explicita) ? h.horas.filter((x) => x.aviso).map((x) => x.aviso as string).slice(0, 1) : [];
  let resto = h.resto;

  const hoy = partesEn(ahora, zona).fecha;
  const [hy, hm] = hoy.split("-").map(Number);
  const candidatas = new Set<string>();
  let explicita: string | null = null;

  const proxima = (mes: number, dia: number, anio?: number): string | null => {
    const y = anio ?? hy;
    if (!fechaExiste(y, mes, dia)) return null;
    let f = iso(y, mes, dia);
    if (anio === undefined && f < hoy) {
      if (!fechaExiste(y + 1, mes, dia)) return null;
      f = iso(y + 1, mes, dia);
    }
    return f;
  };

  // «30 de octubre», «30 oct 2026»
  const reMes = new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${MES_RE})\\b(?:\\s*(?:de\\s+)?(\\d{4}))?`, "g");
  for (const m of [...resto.matchAll(reMes)]) {
    const f = proxima(MESES[m[2]], Number(m[1]), m[3] ? Number(m[3]) : undefined);
    if (!f) return null;
    candidatas.add(f);
    explicita = f;
  }
  resto = resto.replace(reMes, " ");

  // «30/10», «30/10/2026»
  const reBarra = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g;
  for (const m of [...resto.matchAll(reBarra)]) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    const miami = zona === "America/New_York";
    let dia = miami ? b : a;
    let mes = miami ? a : b;
    if (miami && a <= 12 && b <= 12 && a !== b) return null; // 10/11 en Miami: ¿octubre o noviembre? No se arriesga.
    if (mes > 12 && dia <= 12) [dia, mes] = [mes, dia];
    if (mes < 1 || mes > 12) return null;
    let anio: number | undefined;
    if (m[3]) anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const f = proxima(mes, dia, anio);
    if (!f) return null;
    candidatas.add(f);
    explicita = f;
    void a;
    void b;
  }
  resto = resto.replace(reBarra, " ");

  // hoy / mañana / pasado mañana
  if (/\bpasado manana\b/.test(resto)) { candidatas.add(sumarDias(hoy, 2)); resto = resto.replace(/\bpasado manana\b/g, " "); }
  if (/\bmanana\b/.test(resto)) { candidatas.add(sumarDias(hoy, 1)); resto = resto.replace(/\bmanana\b/g, " "); }
  if (/\bhoy\b/.test(resto)) { candidatas.add(hoy); resto = resto.replace(/\bhoy\b/g, " "); }

  // «viernes», «el próximo sábado»: el siguiente (nunca hoy mismo)
  const reDia = new RegExp(`\\b(${DIA_RE})\\b(?:\\s+(\\d{1,2})\\b)?`, "g");
  const dias = [...resto.matchAll(reDia)];
  if (dias.length > 1) return null;
  let porDiaSemana: string | null = null;
  if (dias.length === 1) {
    const objetivo = DIAS_SEMANA.indexOf(dias[0][1]);
    let n = (objetivo - diaSemana(hoy) + 7) % 7;
    if (n === 0) n = 7;
    porDiaSemana = sumarDias(hoy, n);
    // «sábado 31»: el número manda; si no cuadra con el sábado que toca, no se adivina.
    if (dias[0][2] && !explicita && Number(porDiaSemana.slice(8)) !== Number(dias[0][2])) return null;
  }
  resto = resto.replace(reDia, " ");
  if (porDiaSemana) {
    // Con fecha explícita, el día de la semana solo confirma (si no cuadra, no se adivina).
    if (explicita) {
      if (diaSemana(explicita) !== diaSemana(porDiaSemana)) return null;
    } else {
      candidatas.add(porDiaSemana);
    }
  }

  if (candidatas.size !== 1) return null;
  const fecha = [...candidatas][0];
  if (fecha < hoy || diasEntre(hoy, fecha) > 400) return null;

  // Cualquier número suelto que quede («el 20 o 21 de octubre», «para 2 personas») es una duda: que lo lea Claude.
  if (/\b\d{1,4}\b/.test(resto.replace(/\b(el|dia|a|las|la|de|del|para|proximo|este|que|viene|sobre|hacia|y|en|punto|por|tarde|noche|manana|mediodia)\b/g, " "))) return null;
  void hm;
  return { fecha, hora, avisos };
}
