import { REGLAS_ESPANA, ZONA_MADRID, ZONA_MIAMI, type ReglasAgenda } from "./agenda";
import { PERFIL_MIAMI, PERFIL_POR_DEFECTO, type PerfilLegacy } from "./pricing";

/**
 * Blake trabaja en dos sitios y en cada uno cobra de forma distinta: en España en euros, en Miami «al nivel de Miami» y en
 * dólares. La primera pregunta de ManyChat es dónde está la clienta; con ella se decide el perfil de precios de Legacy, la
 * moneda, la zona horaria de la fecha que pide, las reglas de horario y días libres.
 *
 * Lo que Blake aún no ha confirmado de Miami queda en `pendientes`: se enseña como aviso en CADA propuesta de Miami,
 * para que no pase por bueno algo que se ha supuesto.
 */

export const UBICACIONES = ["espana", "miami"] as const;
export type Ubicacion = (typeof UBICACIONES)[number];
export type Moneda = "EUR" | "USD";

export type ConfigUbicacion = {
  nombre: string;
  /** Zona horaria en la que la clienta da la fecha y la hora (y en la que se muestra la cita). */
  zonaHoraria: string;
  moneda: Moneda;
  reglas: ReglasAgenda;
  /** Perfil de Legacy cuando no hay uno guardado en app_settings. */
  perfilPorDefecto: PerfilLegacy;
  /** Clave de app_settings donde Blake puede guardar su perfil de esta ubicación (sin tocar código). */
  clavePerfil: string;
  /** Paga y señal por defecto, en céntimos de la moneda de la ubicación. */
  senalCentimos: number;
  pendientes: string[];
};

export const CONFIG_UBICACION: Record<Ubicacion, ConfigUbicacion> = {
  espana: {
    nombre: "España",
    zonaHoraria: ZONA_MADRID,
    moneda: "EUR",
    reglas: REGLAS_ESPANA,
    perfilPorDefecto: PERFIL_POR_DEFECTO,
    clavePerfil: "perfil_legacy",
    senalCentimos: 2000,
    pendientes: [],
  },
  miami: {
    nombre: "Miami",
    zonaHoraria: ZONA_MIAMI,
    moneda: "USD",
    // Sin horario ni días libres definidos: no se avisa de nada hasta que Blake los diga.
    reglas: { zona: ZONA_MIAMI, diasLibres: null, horario: null },
    perfilPorDefecto: PERFIL_MIAMI,
    clavePerfil: "perfil_legacy_miami",
    senalCentimos: 2000,
    pendientes: ["Miami: la señal (20 $), el horario, los días libres, la dirección y cómo se cobra todavía no los has confirmado: revísalos."],
  },
};

export const interpretarUbicacion = (v: unknown): Ubicacion => (v === "miami" ? "miami" : "espana");

/** «Miami: quiero …» / «España - quiero …» al principio de un /simular: elige el lugar. Sin separador no se toca el texto. */
export function separarUbicacion(texto: string): { ubicacion: Ubicacion; texto: string } {
  const m = /^\s*(miami|españa|espana)\s*[:\-–—]\s*([\s\S]*)$/i.exec(texto);
  if (!m) return { ubicacion: "espana", texto };
  return { ubicacion: m[1].toLowerCase() === "miami" ? "miami" : "espana", texto: m[2] };
}

export const SIMBOLO: Record<Moneda, string> = { EUR: "€", USD: "$" };

/** «20 €», «60,15 $»: el importe en céntimos de la moneda de la ubicación. */
export function dinero(centimos: number | null | undefined, moneda: Moneda = "EUR"): string {
  if (centimos == null) return "—";
  return `${(centimos / 100).toLocaleString("es-ES", { minimumFractionDigits: centimos % 100 ? 2 : 0 })} ${SIMBOLO[moneda]}`;
}
