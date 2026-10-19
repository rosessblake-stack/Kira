import { fechaLarga } from "./agenda";
import { limpiarTexto } from "./intents";
import { horasPorDefecto, materialesPorDefecto, type ServicioParaPrecio } from "./pricing";
import { contextoDe } from "./proposal";
import type { Reserva } from "./proposal-flow";
import { dinero, type Moneda, type Ubicacion } from "./ubicacion";

/**
 * Registro de servicios: la memoria con la que se afinarán las horas y los materiales de cada peinado.
 * Por cada cita aprobada se guarda lo que Kira sugería, lo que Blake dejó al aprobar y, cuando él lo anota con /real,
 * lo que de verdad se tardó y se gastó. Lógica pura: nada de aquí toca la base de datos ni Telegram.
 * Solo campos cerrados (nunca el mensaje de la clienta). Las pruebas (/simular) se guardan, pero no cuentan para calibrar.
 */

export type NuevoRegistro = {
  booking_id: string;
  is_test: boolean;
  ubicacion: Ubicacion;
  moneda: Moneda;
  client_name: string | null;
  starts_at: string | null;
  tipo_trenzado: string | null;
  numero_trenzas: number | null;
  tamano: string | null;
  estilo: string | null;
  extensiones: string | null;
  boho: boolean | null;
  largo_cabello: string | null;
  largo_extensiones: string | null;
  horas_sugeridas: number | null;
  materiales_sugeridos: number | null;
  precio_legacy_cents: number | null;
  horas_aprobadas: number | null;
  materiales_aprobados: number | null;
  precio_aprobado_cents: number | null;
  precio_origen: "legacy" | "manual";
  perfil: Record<string, unknown>;
};

export type RegistroGuardado = NuevoRegistro & {
  id: string;
  seq: number;
  created_at: string;
  horas_reales: number | null;
  materiales_reales: number | null;
  precio_real_cents: number | null;
  nota_real: string | null;
  real_at: string | null;
};

const positivo = (n: number | null | undefined) => (typeof n === "number" && n > 0 ? n : null);

/** La foto fija de una reserva en el momento de aprobarla. */
export function registroDesdeReserva(r: Reserva): NuevoRegistro {
  const spec = r.spec;
  const lugar = contextoDe(spec);
  const s = spec.servicio;
  const manual = spec.precio_manual_centimos !== null;
  const nombre = (spec.nombre ?? "").trim().split(/\s+/)[0] ?? "";
  return {
    booking_id: r.id,
    is_test: r.is_test,
    ubicacion: lugar.ubicacion,
    moneda: lugar.moneda,
    client_name: nombre ? limpiarTexto(nombre, 40) : null,
    starts_at: r.starts_at,
    tipo_trenzado: s.tipo_trenzado,
    numero_trenzas: s.numero_trenzas,
    tamano: s.tamano,
    estilo: s.estilo_pegadas,
    extensiones: s.extensiones,
    boho: s.boho,
    largo_cabello: s.largo_cabello,
    largo_extensiones: s.largo_extensiones,
    horas_sugeridas: positivo(horasPorDefecto(s)),
    materiales_sugeridos: s.tipo_trenzado ? materialesPorDefecto(s) : null,
    precio_legacy_cents: r.pricing?.origen === "legacy" && r.pricing.legacy ? r.pricing.legacy.totalCentimos : null,
    horas_aprobadas: positivo(spec.horas ?? horasPorDefecto(s)),
    materiales_aprobados: s.tipo_trenzado ? (spec.materiales ?? materialesPorDefecto(s)) : null,
    precio_aprobado_cents: r.price_cents,
    precio_origen: manual ? "manual" : "legacy",
    perfil: (r.pricing?.perfil ?? {}) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// «/real 12 horas 3,5; materiales 9; precio 80; nota fue rápido»
// ---------------------------------------------------------------------------

export type DatosReales = {
  horas?: number;
  materiales?: number;
  precioCents?: number;
  nota?: string | null;
};

const quitarAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

function importe(txt: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(?:€|\$|h|horas?|eur|euros|usd|d[oó]lares)?\s*$/i.exec(txt);
  return m ? Number(m[1].replace(",", ".")) : null;
}

export function parsearReal(texto: string): { datos: DatosReales; errores: string[] } {
  const datos: DatosReales = {};
  const errores: string[] = [];
  for (const linea of texto.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean)) {
    const m = /^(\S+)\s*(.*)$/.exec(linea);
    if (!m) continue;
    const clave = quitarAcentos(m[1].toLowerCase()).replace(/:$/, "");
    const valor = m[2].trim();
    const err = (msg: string) => errores.push(`«${linea.length > 60 ? `${linea.slice(0, 59)}…` : linea}»: ${msg}`);
    switch (clave) {
      case "horas":
      case "hora": {
        const n = importe(valor);
        if (n === null || n <= 0 || n > 24) err("las horas deben estar entre 0,25 y 24, por ejemplo «horas 3,5».");
        else datos.horas = Math.round(n * 4) / 4;
        break;
      }
      case "materiales":
      case "material": {
        const n = importe(valor);
        if (n === null || n > 1000) err("los materiales deben ser un importe, por ejemplo «materiales 9».");
        else datos.materiales = Math.round(n * 100) / 100;
        break;
      }
      case "precio":
      case "cobrado": {
        const n = importe(valor);
        if (n === null || n > 5000) err("el precio debe ser un importe, por ejemplo «precio 80».");
        else datos.precioCents = Math.round(n * 100);
        break;
      }
      case "nota": {
        const v = limpiarTexto(valor, 500);
        datos.nota = v || null;
        break;
      }
      default:
        err("no sé qué anotar con eso. Claves: horas, materiales, precio, nota.");
    }
  }
  return { datos, errores };
}

// ---------------------------------------------------------------------------
// Texto para Telegram
// ---------------------------------------------------------------------------

const NOMBRE_TIPO: Record<string, string> = { pegadas: "pegadas", sueltas: "sueltas", fulani: "fulani" };
const decimal = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** «6 trenzas pegadas · con extensiones» */
export function etiquetaServicio(r: Pick<NuevoRegistro, "tipo_trenzado" | "numero_trenzas" | "tamano" | "extensiones">): string {
  const partes: string[] = [];
  if (r.tipo_trenzado === "pegadas") partes.push(`${r.numero_trenzas ? `${r.numero_trenzas} ` : ""}trenzas pegadas`);
  else if (r.tipo_trenzado) partes.push(`${NOMBRE_TIPO[r.tipo_trenzado] ?? r.tipo_trenzado}${r.tamano ? ` ${r.tamano}` : ""}`);
  else partes.push("servicio sin concretar");
  if (r.extensiones === "con" || r.extensiones === "feedin") partes.push("con extensiones");
  else if (r.extensiones === "sin") partes.push("sin extensiones");
  return partes.join(" · ");
}

export function lineaRegistro(r: RegistroGuardado): string {
  const lugar = contextoDe({ ubicacion: r.ubicacion });
  const cuando = r.starts_at ? fechaLarga(new Date(r.starts_at), lugar.zonaHoraria) : "sin fecha";
  const aprobado = [
    r.horas_aprobadas !== null ? `${decimal(r.horas_aprobadas)} h` : null,
    r.materiales_aprobados !== null ? dinero(Math.round(r.materiales_aprobados * 100), r.moneda) : null,
    r.precio_aprobado_cents !== null ? dinero(r.precio_aprobado_cents, r.moneda) : null,
  ].filter(Boolean).join(" · ");
  const real = r.real_at
    ? [
        r.horas_reales !== null ? `${decimal(r.horas_reales)} h` : null,
        r.materiales_reales !== null ? `materiales ${dinero(Math.round(r.materiales_reales * 100), r.moneda)}` : null,
        r.precio_real_cents !== null ? `cobrado ${dinero(r.precio_real_cents, r.moneda)}` : null,
      ].filter(Boolean).join(" · ") || "anotado"
    : "sin anotar";
  return [
    `#${r.seq} ${r.is_test ? "🧪 " : ""}${r.client_name ?? "sin nombre"} · ${cuando} · ${etiquetaServicio(r)}`,
    `   aprobado: ${aprobado || "—"}`,
    `   real: ${real}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Resumen por tipo de servicio (/datos)
// ---------------------------------------------------------------------------

export type GrupoDatos = {
  clave: string;
  titulo: string;
  n: number;
  horas: { media: number; min: number; max: number } | null;
  materiales: number | null;
  precioCents: number | null;
  moneda: Moneda;
  /** Lo que Kira sugiere hoy para este servicio (para ver cuánto se desvía de lo real). */
  sugeridas: number | null;
};

const media = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

const claveDe = (r: RegistroGuardado) => [r.moneda, r.tipo_trenzado, r.tipo_trenzado === "pegadas" ? r.numero_trenzas : r.tamano, r.extensiones === "sin" ? "sin" : r.extensiones ? "con" : "?"].join("|");

/** Agrupa los servicios con datos reales por tipo, tamaño (o nº de trenzas) y extensiones. */
export function agruparDatos(registros: RegistroGuardado[]): GrupoDatos[] {
  const grupos = new Map<string, RegistroGuardado[]>();
  for (const r of registros) {
    if (!r.real_at) continue;
    const k = claveDe(r);
    grupos.set(k, [...(grupos.get(k) ?? []), r]);
  }
  const out: GrupoDatos[] = [];
  for (const [clave, rs] of grupos) {
    const horas = rs.map((r) => r.horas_reales).filter((h): h is number => h !== null);
    const mats = rs.map((r) => r.materiales_reales).filter((m): m is number => m !== null);
    const precios = rs.map((r) => r.precio_real_cents).filter((p): p is number => p !== null);
    const ref = rs[0];
    const servicio: ServicioParaPrecio = {
      tipo_trenzado: (ref.tipo_trenzado as ServicioParaPrecio["tipo_trenzado"]) ?? null,
      numero_trenzas: ref.numero_trenzas,
      tamano: (ref.tamano as ServicioParaPrecio["tamano"]) ?? null,
      estilo_pegadas: null,
      extensiones: (ref.extensiones as ServicioParaPrecio["extensiones"]) ?? null,
      boho: null,
      largo_cabello: null,
      largo_extensiones: null,
    };
    out.push({
      clave,
      titulo: etiquetaServicio(ref),
      n: rs.length,
      horas: horas.length ? { media: media(horas), min: Math.min(...horas), max: Math.max(...horas) } : null,
      materiales: mats.length ? media(mats) : null,
      precioCents: precios.length ? Math.round(media(precios)) : null,
      moneda: ref.moneda,
      sugeridas: positivo(horasPorDefecto(servicio)),
    });
  }
  return out.sort((a, b) => b.n - a.n || a.titulo.localeCompare(b.titulo));
}

export function textoDatos(grupos: GrupoDatos[], pruebasExcluidas: number): string {
  if (!grupos.length) {
    return [
      "Todavía no hay servicios reales anotados.",
      "Cuando termines una cita, anota lo que de verdad tardaste y gastaste: /real (te enseño las últimas) y luego, por ejemplo, /real 12 horas 3,5; materiales 9; precio 80",
      pruebasExcluidas ? `(Hay ${pruebasExcluidas} de prueba que no cuentan.)` : "",
    ].filter(Boolean).join("\n");
  }
  const l = ["📊 Lo que de verdad pasa en cada servicio (solo citas reales que has anotado)", ""];
  for (const g of grupos) {
    const partes = [
      g.horas ? `${decimal(g.horas.media)} h de media${g.n > 1 ? ` (de ${decimal(g.horas.min)} a ${decimal(g.horas.max)})` : ""}` : null,
      g.materiales !== null ? `materiales ${dinero(Math.round(g.materiales * 100), g.moneda)}` : null,
      g.precioCents !== null ? `cobras ${dinero(g.precioCents, g.moneda)}` : null,
    ].filter(Boolean).join(" · ");
    l.push(`• ${g.titulo} — ${g.n} ${g.n === 1 ? "servicio" : "servicios"}: ${partes || "sin importes"}`);
    if (g.sugeridas !== null && g.horas && Math.abs(g.horas.media - g.sugeridas) >= 0.5) {
      l.push(`   Kira sugiere ${decimal(g.sugeridas)} h: se desvía ${decimal(Math.abs(g.horas.media - g.sugeridas))} h.`);
    }
  }
  if (pruebasExcluidas) l.push("", `(No cuento ${pruebasExcluidas} de prueba.)`);
  l.push("", "Con varios servicios del mismo tipo ya se puede ajustar lo que Kira sugiere por defecto.");
  return l.join("\n");
}
