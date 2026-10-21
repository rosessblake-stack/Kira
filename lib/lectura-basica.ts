import { ZONA_MADRID, partesEn } from "./agenda";

/**
 * Lectura básica por reglas: una alternativa SIN Claude para poder probar todo el recorrido (/simular)
 * cuando todavía no hay ANTHROPIC_API_KEY. Devuelve lo mismo que pediría el esquema de Claude, de modo que
 * pasa por la misma validación estricta (validarClasificacion) y por los mismos filtros.
 *
 * Es deliberadamente CONSERVADORA: lo que no está claro se deja como "no indicado" (nunca se deduce), y
 * "6 trenzas" a secas NO se interpreta como pegadas ni como sueltas. Solo se usa en conversaciones de prueba;
 * un canal real nunca debe caer en esta lectura. Cada propuesta avisa de que no la ha hecho Claude.
 */

const NO = "no_indicado";

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const NUMEROS: Record<string, number> = {
  un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_SEMANA: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

const COLORES: [RegExp, string][] = [
  [/^roj/, "rojo"], [/^negr/, "negro"], [/^rubi/, "rubio"], [/^castan/, "castaño"], [/^marron/, "marrón"], [/^azul/, "azul"],
  [/^ros[ao]/, "rosa"], [/^morad/, "morado"], [/^violeta/, "violeta"], [/^verde/, "verde"], [/^burdeos/, "burdeos"],
  [/^naranja/, "naranja"], [/^amarill/, "amarillo"], [/^gris/, "gris"], [/^blanc/, "blanco"], [/^platead/, "plateado"],
  [/^dorad/, "dorado"], [/^cobre/, "cobre"], [/^miel/, "miel"],
];
const COLOR_RE = /\b(?:extensiones?|trenzas?)\b[^.!?\n]{0,50}?\b(roj[oa]s?|negr[oa]s?|rubi[oa]s?|castan[oa]s?|marron(?:es)?|azul(?:es)?|ros[ao]s?|morad[oa]s?|violeta|verdes?|burdeos|naranjas?|amarill[oa]s?|gris(?:es)?|blanc[oa]s?|platead[oa]s?|dorad[oa]s?|cobre|miel)\b/;

// ---------------------------------------------------------------------------
// Fecha y hora
// ---------------------------------------------------------------------------

const aIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function fechaReal(y: number, m: number, d: number): number | null {
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? ms : null;
}

/** AAAA-MM-DD en el calendario de la clienta (por defecto, Madrid), o null si el mensaje no da una fecha clara. */
export function extraerFecha(t: string, ahora: Date, zona: string = ZONA_MADRID): string | null {
  const hoy = partesEn(ahora, zona);
  const [hy, hm, hd] = hoy.fecha.split("-").map(Number);
  const hoyMs = Date.UTC(hy, hm - 1, hd);
  const DIA = 86_400_000;

  // Sin año: la próxima vez que llega esa fecha.
  const conAnio = (d: number, m: number, anio?: string) => {
    if (anio) return fechaReal(Number(anio.length === 2 ? `20${anio}` : anio), m, d);
    const esteAnio = fechaReal(hy, m, d);
    if (esteAnio !== null && esteAnio >= hoyMs) return esteAnio;
    return fechaReal(hy + 1, m, d);
  };

  let m = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MESES.join("|")})(?:\\s+(?:de|del)\\s+(\\d{4}))?`).exec(t);
  if (m) {
    const ms = conAnio(Number(m[1]), MESES.indexOf(m[2]) + 1, m[3]);
    return ms === null ? null : aIso(ms);
  }
  m = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?\b/.exec(t);
  if (m) {
    const ms = conAnio(Number(m[1]), Number(m[2]), m[3]);
    if (ms !== null) return aIso(ms);
  }
  if (/\bpasado\s+manana\b/.test(t)) return aIso(hoyMs + 2 * DIA);
  // "por la mañana" / "de la mañana" no es «mañana» (el día siguiente).
  if (/(?<!\bla\s)\bmanana\b/.test(t)) return aIso(hoyMs + DIA);

  m = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b(?:\s+(?:dia\s+)?(\d{1,2})\b)?/.exec(t);
  if (m) {
    if (m[2]) {
      // "jueves 22": el día 22 de este mes si aún no ha pasado, y si no, del siguiente.
      const d = Number(m[2]);
      const esteMes = fechaReal(hy, hm, d);
      if (esteMes !== null && esteMes >= hoyMs) return aIso(esteMes);
      const sig = fechaReal(hm === 12 ? hy + 1 : hy, hm === 12 ? 1 : hm + 1, d);
      return sig === null ? null : aIso(sig);
    }
    const objetivo = DIAS_SEMANA[m[1]];
    let delta = (objetivo - hoy.diaSemana + 7) % 7;
    if (delta === 0) delta = 7; // «el martes» dicho un martes = el siguiente
    return aIso(hoyMs + delta * DIA);
  }
  return null;
}

/** HH:MM en 24 h y, si hubo que suponerla, una nota para Blake. */
export function extraerHora(t: string): { hora: string; nota?: string } | null {
  const fmt = (h: number, min: number) => `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  const conAmPm = (h: number, ap?: string) => (ap === "pm" && h < 12 ? h + 12 : ap === "am" && h === 12 ? 0 : h);

  let m = /\b([01]?\d|2[0-3])(?::|h)([0-5]\d)\s*(am|pm)?\b/.exec(t);
  if (m) {
    const h = conAmPm(Number(m[1]), m[3]);
    return h <= 23 ? { hora: fmt(h, Number(m[2])) } : null;
  }
  m = /\b(\d{1,2})\s*(am|pm)\b/.exec(t);
  if (m) {
    const h = conAmPm(Number(m[1]), m[2]);
    return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? { hora: fmt(h, 0) } : null;
  }
  m = /\b(?:a|sobre|hacia)\s+las?\s+(\d{1,2})(?:\s*(?:h|horas))?\b/.exec(t);
  if (m) {
    const h = Number(m[1]);
    if (h < 1 || h > 23) return null;
    // En el horario del salón (11:00-22:00) «a las 5» solo puede ser la tarde.
    if (h <= 10) return { hora: fmt(h + 12, 0), nota: `«a las ${h}» se ha leído como ${fmt(h + 12, 0)} (horario del salón 11:00–22:00).` };
    return { hora: fmt(h, 0) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Largos
// ---------------------------------------------------------------------------

function largoDeFrase(frase: string): string | null {
  if (/\b(?:media\s+espalda|mitad\s+de\s+la\s+espalda)\b/.test(frase)) return "media_espalda";
  if (/\bcaderas?\b/.test(frase)) return "caderas";
  if (/\b(?:muslos?|rodillas?)\b/.test(frase)) return "mas_largo";
  if (/\bhombros?\b/.test(frase)) return "hombros";
  if (/\bnuca\b/.test(frase)) return "nuca";
  return null;
}

// ---------------------------------------------------------------------------
// Lectura completa
// ---------------------------------------------------------------------------

export type LecturaBasica = Record<string, unknown>;

const DERIVAR_SIEMPRE =
  /\b(reembolso|devolucion|queja|reclamacion|descuento|colaboracion|colaborar|prensa|influencer|menor\s+de\s+edad|urgente|enfadad[oa])\b|\bmi\s+hij[oa]\s+(?:de\s+)?\d{1,2}\s+anos\b/;

export function leerBasico(texto: string, ahora: Date, zona: string = ZONA_MADRID): LecturaBasica {
  const t = sinAcentos(texto);
  // El aviso de que no la leyó Claude lo añade la propuesta; aquí solo van las dudas concretas del mensaje.
  const notas: string[] = [];

  // --- intención
  const curso = /\b(curso|formacion|academia|infoproducto|masterclass)\b/.test(t);
  const servicio = /\b(trenza|trenzas|braids?|fulani|cornrows?|boxer|boxeadoras?|extensiones|rastas|twist|peinado)\b/.test(t);
  const pregunta = /\b(cuanto|precio|precios|cuesta|tarifa|vale)\b/.test(t);
  const fecha = extraerFecha(t, ahora, zona);

  let intencion = "derivar_a_blake";
  if (DERIVAR_SIEMPRE.test(t)) intencion = "derivar_a_blake";
  else if (curso) {
    intencion = /\bpresencial\b/.test(t) ? "info_formacion_presencial" : /\b(online|on-line|digital|virtual)\b/.test(t) ? "info_formacion_online" : "derivar_a_blake";
  } else if (servicio) {
    // Solo pregunta el precio: sin fecha y sin palabras de reserva.
    const reserva = /\b(cita|reservar|reserva|hueco|disponib\w*)\b/.test(t);
    intencion = pregunta && !fecha && !reserva ? "precio_servicio" : "cita_salon";
  } else if (pregunta) intencion = "precio_servicio";
  else if (texto.trim().length < 60 && /^\s*(hola|buenas|buenos\s+dias|buenas\s+tardes|gracias|muchas\s+gracias)\b/.test(t)) intencion = "saludo_o_gracias";

  // --- servicio
  const n = /\b(\d{1,3}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+(?:trenzas?|braids?|boxers?|boxeadoras?|rastas?|cornrows?|pegadas?)\b/.exec(t);
  const bruto = n ? (/^\d+$/.test(n[1]) ? Number(n[1]) : NUMEROS[n[1]]) : 0;
  const numero = bruto > 200 ? 0 : bruto; // más de 200 no es un número de trenzas creíble: no se usa

  const pegadas = /\b(pegadas?|cornrows?|feed[\s-]?in|stitch|al\s+cuero\s+cabelludo)\b/.test(t);
  const sueltas = /\b(sueltas?|box\s+braids?|knotless|knot\s+less)\b/.test(t);
  const fulani = /\bfulani\b/.test(t);
  const tipos = [pegadas && "pegadas", sueltas && "sueltas", fulani && "fulani"].filter(Boolean) as string[];
  // Si el mensaje menciona más de un tipo, no se adivina cuál es.
  const tipo = tipos.length === 1 ? tipos[0] : NO;

  const tam = /\b(xs[\s_-]?small|extra[\s-]?small|jumbo|large|lardium|smedium|s[\s-]?medium|medium|small)\b/.exec(t);
  const tamano = tam ? (/xs|extra/.test(tam[1]) ? "xs_small" : /^s[\s-]?medium$|smedium/.test(tam[1]) ? "smedium" : tam[1]) : NO;

  const estilo = /\bbarrel[\s-]?twist\b/.test(t) ? "barrel_twist" : /\b(?:flat[\s-]?)?twist\b/.test(t) ? "twist" : /\bcornrows?\b/.test(t) ? "cornrows" : NO;

  const extensiones = /\bsin\s+extensiones\b/.test(t) ? "sin" : /\bfeed[\s-]?in\b/.test(t) ? "feedin" : /\bextensiones?\b/.test(t) ? "con" : NO;

  const c = COLOR_RE.exec(t);
  const color = c ? (COLORES.find(([re]) => re.test(c[1]))?.[1] ?? "") : "";

  const boho = /\bsin\s+boho\b/.test(t) ? "no" : /\bboho\b/.test(t) ? "si" : NO;

  // --- largos: el del pelo de la clienta y el de las trenzas se leen por separado
  let largoCabello = NO;
  const pelo = /\b(?:pelo|cabello|melena)\b\s+(?:muy\s+)?(?:\w+\s+){0,3}?(?:(?:por|hasta|a|en)\s+(?:el|la|las|los)?\s*)?(media\s+espalda|caderas?|hombros?|nuca|corto)\b/.exec(t);
  if (pelo) {
    const v = pelo[1];
    largoCabello = /media/.test(v) ? "media_espalda" : /cadera/.test(v) ? "caderas" : /hombro|nuca/.test(v) ? "nuca_hombros" : /muy\s+corto/.test(pelo[0]) ? "muy_corto" : "corto";
  }
  let largoExt = NO;
  const desdeTrenzas = t.slice(Math.max(0, t.search(/\b(?:trenzas?|extensiones?)\b/)));
  const ext = /\b(?:trenzas?|extensiones?)\b[^.!?\n]{0,50}?\b(?:por|hasta|a|llegando\s+a)\s+(?:el|la|las|los)?\s*(media\s+espalda|caderas?|hombros?|nuca|muslos?|rodillas?)\b/.exec(desdeTrenzas);
  if (ext) largoExt = largoDeFrase(ext[1]) ?? NO;

  // --- hora, contacto
  const hora = extraerHora(t);
  if (hora?.nota) notas.push(hora.nota);

  const email = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,80}\.[A-Za-z]{2,24}/.exec(texto)?.[0] ?? "";
  const ig = /(?:^|\s)@([A-Za-z0-9._]{1,30})\b/.exec(texto)?.[1] ?? "";
  const nombre = /\b(?:[Ss]oy|[Mm]e\s+llamo|[Mm]i\s+nombre\s+es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/.exec(texto)?.[1] ?? "";

  if (intencion === "cita_salon" && numero && tipo === NO) notas.push("No dice si son pegadas o sueltas.");
  if (tipos.length > 1) notas.push("Menciona más de un tipo de trenzado: no se ha elegido ninguno.");

  const datos = [numero > 0, tipo !== NO, extensiones !== NO, fecha !== null].filter(Boolean).length;
  return {
    intencion,
    confianza: intencion === "cita_salon" && datos >= 2 ? "media" : "baja",
    manipulacion: false,
    tipo_trenzado: tipo,
    numero_trenzas: numero,
    tamano,
    estilo_pegadas: estilo,
    extensiones,
    color_extensiones: color,
    boho,
    largo_cabello: largoCabello,
    largo_extensiones: largoExt,
    fecha: fecha ?? "",
    hora: hora?.hora ?? "",
    nombre,
    email,
    instagram: ig,
    notas: notas.join(" ").slice(0, 300),
  };
}
