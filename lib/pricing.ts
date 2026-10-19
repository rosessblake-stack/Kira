import { TAMANOS, type Clasificacion } from "./intents";

/**
 * Precios: los calcula Legacy (su fórmula vive en su servidor), nunca Claude.
 * Kira solo le pasa el perfil de Blake y lo que pide la clienta, y recoge el resultado.
 *
 * Importante: cada llamada a /api/calculate guarda una fila en legacy_data de Legacy. Por eso Kira usa un
 * email INTERNO de marcador (nunca el de la clienta ni el de Blake) y un nombre de servicio con prefijo
 * "[Kira]": esas filas se reconocen y se pueden borrar de golpe sin tocar datos de usuarios reales.
 */

export const LEGACY_API_URL = process.env.LEGACY_API_URL?.trim() || "https://legacy-rosy-rho.vercel.app/api/calculate";
export const EMAIL_INTERNO = process.env.LEGACY_INTERNAL_EMAIL?.trim() || "kira-interno@kira.invalid";
const TIMEOUT_MS = 15_000;

export type PerfilLegacy = {
  pais: string;
  zona: "premium" | "media" | "baja";
  estructura: "casa" | "salon";
  nivel: "junior" | "intermedio" | "avanzado" | "profesional" | "elite";
  /** Base salarial mensual en moneda local (Legacy la usa como base de la tarifa): el salario medio (SME) o el mínimo (SMI), según elija Blake. */
  smi: number;
  /** false hasta que Blake confirme estos valores: se avisa en cada propuesta. */
  confirmado: boolean;
};

/**
 * Perfil de Blake, CONFIRMADO por él: trabaja en casa, nivel élite, zona normal (= «media» en Legacy), España.
 * Base salarial: en Legacy Blake calcula con el SALARIO MEDIO (SME), no con el mínimo (su SMI de 1200 € no es la base que usa).
 * Se parte del SME de Barcelona en Legacy (1500 €): con él Legacy da 75,65 € / 56,56 € en las 6 pegadas con / sin extensiones
 * (Blake cobra 80 € / 60 €: encaja con un redondeo a los 10 €, sin confirmar). SUPUESTO: Blake no dijo la ciudad; si es otra,
 * se cambia guardando `perfil_legacy` en app_settings o este número.
 * («Referente internacional» es una pregunta de la pantalla de Legacy que no entra en la fórmula del precio.)
 * Para cambiarlo sin tocar código basta guardar `perfil_legacy` en app_settings.
 */
export const PERFIL_POR_DEFECTO: PerfilLegacy = {
  pais: "es",
  zona: "media",
  estructura: "casa",
  nivel: "elite",
  smi: 1500,
  confirmado: true,
};

/**
 * Perfil de Blake en MIAMI (dicho por él: «en Miami suelo estar en salón y zona premium»); dólares.
 * Base salarial (en Miami Blake usa el SMI, dicho por él): el salario mínimo de Florida desde el 30-sep-2026 es 15,00 $/hora (Miami-Dade no tiene uno propio; el federal, 7,25 $,
 * es menor y no manda). Legacy pide el mínimo MENSUAL y su suelo de EE. UU. (1256 $) sale de 7,25 $ × 173,33 h/mes (40 h × 52
 * semanas / 12), así que con la misma cuenta: 15 × 173,33 = 2600 $/mes. Desde 2027 Florida lo ajusta cada septiembre por
 * inflación: hay que revisarlo entonces. El nivel (élite) se da por el mismo que en España.
 */
export const PERFIL_MIAMI: PerfilLegacy = {
  pais: "us",
  zona: "premium",
  estructura: "salon",
  nivel: "elite",
  smi: 2600,
  confirmado: true,
};

const ZONAS = ["premium", "media", "baja"] as const;
const ESTRUCTURAS = ["casa", "salon"] as const;
const NIVELES = ["junior", "intermedio", "avanzado", "profesional", "elite"] as const;

/**
 * Lee el perfil guardado: sin nada guardado, el de Blake de ese lugar (`porDefecto`); si lo guardado está roto, el mismo pero
 * marcado «sin confirmar».
 */
export function interpretarPerfil(raw: unknown, porDefecto: PerfilLegacy = PERFIL_POR_DEFECTO): PerfilLegacy {
  if (raw === null || raw === undefined) return porDefecto;
  const PERFIL_DE_RESPALDO: PerfilLegacy = { ...porDefecto, confirmado: false };
  if (typeof raw !== "object") return PERFIL_DE_RESPALDO;
  const o = raw as Record<string, unknown>;
  const zona = (ZONAS as readonly unknown[]).includes(o.zona) ? (o.zona as PerfilLegacy["zona"]) : null;
  const estructura = (ESTRUCTURAS as readonly unknown[]).includes(o.estructura) ? (o.estructura as PerfilLegacy["estructura"]) : null;
  const nivel = (NIVELES as readonly unknown[]).includes(o.nivel) ? (o.nivel as PerfilLegacy["nivel"]) : null;
  const smi = typeof o.smi === "number" && Number.isFinite(o.smi) && o.smi > 0 && o.smi < 100_000 ? o.smi : null;
  const pais = typeof o.pais === "string" && /^[a-z]{2,5}$/.test(o.pais) ? o.pais : null;
  if (!zona || !estructura || !nivel || !smi || !pais) return PERFIL_DE_RESPALDO;
  return { pais, zona, estructura, nivel, smi, confirmado: o.confirmado === true };
}

// ---------------------------------------------------------------------------
// Horas y materiales por defecto (PROVISIONALES: los confirma Blake con "horas N" al editar)
// ---------------------------------------------------------------------------

const HORAS_SUELTAS: Record<(typeof TAMANOS)[number], number> = {
  jumbo: 3, large: 3.5, lardium: 5, medium: 6, smedium: 7, small: 8, xs_small: 10,
};
const MATERIALES_POR_DEFECTO = { pegadas: 5, sueltas: 10, fulani: 10 } as const;

const aMediaHora = (h: number) => Math.round(h * 2) / 2;

export type ServicioParaPrecio = Pick<
  Clasificacion,
  "tipo_trenzado" | "numero_trenzas" | "tamano" | "estilo_pegadas" | "extensiones" | "boho" | "largo_cabello" | "largo_extensiones"
>;

/**
 * Horas sugeridas (Blake las afina con «horas N»). Datos reales de Blake: 6 trenzas pegadas sin extensiones ≈ 2 h, con
 * extensiones ≈ 3 h y sueltas large ≈ 3,5 h. Para otros números de trenzas se escala: 0,5 h + 15 min por trenza y, con
 * extensiones, ×1,5 (con un solo dato de 6 trenzas, esto último es una estimación). Los otros tamaños de sueltas y las fulani
 * siguen siendo valores provisionales.
 */
export function horasPorDefecto(s: ServicioParaPrecio): number {
  if (s.tipo_trenzado === "pegadas") {
    const base = s.numero_trenzas ? Math.max(1, aMediaHora(0.5 + 0.25 * s.numero_trenzas)) : 2;
    const conExtensiones = s.extensiones === "con" || s.extensiones === "feedin";
    return Math.min(8, Math.max(1, conExtensiones ? aMediaHora(base * 1.5) : base));
  }
  if ((s.tipo_trenzado === "sueltas" || s.tipo_trenzado === "fulani") && s.tamano) return HORAS_SUELTAS[s.tamano];
  return 0;
}

export function materialesPorDefecto(s: ServicioParaPrecio): number {
  return s.tipo_trenzado ? MATERIALES_POR_DEFECTO[s.tipo_trenzado] : 0;
}

/** Qué le falta saber a Kira para poder pedir el precio a Legacy. Vacío = se puede calcular. */
export function datosFaltantes(s: ServicioParaPrecio): string[] {
  const f: string[] = [];
  if (!s.tipo_trenzado) f.push("tipo de trenzado (pegadas, sueltas o fulani)");
  if ((s.tipo_trenzado === "sueltas" || s.tipo_trenzado === "fulani") && !s.tamano) {
    f.push("tamaño de las trenzas (jumbo, large, medium, small…)");
  }
  if (!s.extensiones) f.push("si lleva extensiones");
  return f;
}

// ---------------------------------------------------------------------------
// Petición a Legacy
// ---------------------------------------------------------------------------

export type PeticionLegacy = Record<string, string | number>;

export function construirPeticion(
  s: ServicioParaPrecio,
  perfil: PerfilLegacy,
  horas: number,
  materiales: number,
): PeticionLegacy {
  const ext = s.extensiones ?? "sin";
  const boho = s.boho ? "si" : "no";
  const base: PeticionLegacy = {
    email: EMAIL_INTERNO,
    instagram: "",
    pais: perfil.pais,
    zona: perfil.zona,
    smi: perfil.smi,
    clienteTipo: "local",
    nombreServicio: "[Kira] cotización de cita",
    nivel: perfil.nivel,
    estructura: perfil.estructura,
    horas,
    materiales,
    precioActual: 0,
    tipoTrenzado: s.tipo_trenzado ?? "",
    largoCabello: s.largo_cabello ?? "",
    largoExtensiones: s.largo_extensiones ?? "",
  };
  if (s.tipo_trenzado === "pegadas") {
    return {
      ...base,
      tipoPegadas: s.estilo_pegadas ?? "cornrows",
      complejidadPegadas: "basico",
      extensionesPegadas: ext,
      bohoPegadas: boho,
    };
  }
  if (s.tipo_trenzado === "sueltas") {
    return {
      ...base,
      tamanoSueltas: s.tamano ?? "",
      tipoSueltas: s.estilo_pegadas === "twist" ? "twist" : "box",
      extensionesSueltas: ext === "sin" ? "sin" : "con",
      bohoSueltas: boho,
    };
  }
  return {
    ...base,
    tamanoFulaniAtras: s.tamano ?? "",
    complejidadFulaniDelante: "simples",
    extensionesFulani: ext === "sin" ? "sin" : "con",
    bohoFulani: boho,
  };
}

export type PrecioLegacy = {
  totalCentimos: number;
  manoObra: number;
  materiales: number;
  tarifaHora: number;
  valorConocimiento: number;
  costeTiempo: number;
};

export class LegacyError extends Error {
  constructor(
    message: string,
    readonly estado?: number,
  ) {
    super(message);
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Valida la respuesta de Legacy: si algo no cuadra no se usa (no se "arregla"). */
export function interpretarRespuesta(json: unknown): PrecioLegacy {
  const o = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const total = num(o.precioTotal);
  const manoObra = num(o.precioManoObra);
  const materiales = num(o.materiales);
  const tarifaHora = num(o.tarifaHora);
  if (total === null || manoObra === null || materiales === null || tarifaHora === null) {
    throw new LegacyError("La respuesta de Legacy no tiene el formato esperado");
  }
  if (total <= 0 || total > 5000) throw new LegacyError(`Legacy devolvió un precio fuera de rango (${total})`);
  return {
    totalCentimos: Math.round(total * 100),
    manoObra,
    materiales,
    tarifaHora,
    valorConocimiento: num(o.valorConocimiento) ?? 0,
    costeTiempo: num(o.costeTiempo) ?? 0,
  };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export async function consultarLegacy(peticion: PeticionLegacy, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<PrecioLegacy> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(LEGACY_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(peticion),
      signal: ctl.signal,
    });
    const texto = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(texto);
    } catch {
      /* la respuesta no era JSON (p. ej. una página de login de Vercel) */
    }
    if (!res.ok) {
      const detalle = json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : "sin detalle";
      throw new LegacyError(`Legacy respondió ${res.status}: ${detalle.slice(0, 120)}`, res.status);
    }
    if (json === null) throw new LegacyError("Legacy no devolvió JSON (¿protección de acceso de Vercel?)", res.status);
    return interpretarRespuesta(json);
  } catch (e) {
    if (e instanceof LegacyError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new LegacyError("Legacy no respondió a tiempo");
    throw new LegacyError("No se pudo conectar con Legacy");
  } finally {
    clearTimeout(t);
  }
}
