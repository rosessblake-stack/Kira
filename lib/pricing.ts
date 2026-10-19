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
  /** Salario mínimo mensual en moneda local (Legacy lo usa como base de la tarifa). */
  smi: number;
  /** false hasta que Blake confirme estos valores: se avisa en cada propuesta. */
  confirmado: boolean;
};

/**
 * Perfil de Blake, CONFIRMADO por él: trabaja en casa, nivel élite, zona normal (= «media» en Legacy), España, SMI 1200 €.
 * («Referente internacional» es una pregunta de la pantalla de Legacy que no entra en la fórmula del precio.)
 * Para cambiarlo sin tocar código basta guardar `perfil_legacy` en app_settings.
 */
export const PERFIL_POR_DEFECTO: PerfilLegacy = {
  pais: "es",
  zona: "media",
  estructura: "casa",
  nivel: "elite",
  smi: 1200,
  confirmado: true,
};

/** Si el perfil guardado en app_settings está corrupto se usan los valores de Blake, pero avisando en cada propuesta. */
const PERFIL_DE_RESPALDO: PerfilLegacy = { ...PERFIL_POR_DEFECTO, confirmado: false };

const ZONAS = ["premium", "media", "baja"] as const;
const ESTRUCTURAS = ["casa", "salon"] as const;
const NIVELES = ["junior", "intermedio", "avanzado", "profesional", "elite"] as const;

/** Lee el perfil guardado: sin nada guardado, el de Blake; si lo guardado está roto, el de Blake pero marcado «sin confirmar». */
export function interpretarPerfil(raw: unknown): PerfilLegacy {
  if (raw === null || raw === undefined) return PERFIL_POR_DEFECTO;
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
  jumbo: 3, large: 4, lardium: 5, medium: 6, smedium: 7, small: 8, xs_small: 10,
};
const MATERIALES_POR_DEFECTO = { pegadas: 5, sueltas: 10, fulani: 10 } as const;

const aMediaHora = (h: number) => Math.round(h * 2) / 2;

export type ServicioParaPrecio = Pick<
  Clasificacion,
  "tipo_trenzado" | "numero_trenzas" | "tamano" | "estilo_pegadas" | "extensiones" | "boho" | "largo_cabello" | "largo_extensiones"
>;

export function horasPorDefecto(s: ServicioParaPrecio): number {
  if (s.tipo_trenzado === "pegadas") {
    // 2 trenzas ≈ 1 h (como las "Boxeadoras" que Blake calculó): 0,5 h + 15 min por trenza.
    return s.numero_trenzas ? Math.min(8, Math.max(1, aMediaHora(0.5 + 0.25 * s.numero_trenzas))) : 2;
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
