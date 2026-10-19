import { DIAS_LIBRES, HORARIO, REGLAS_ESPANA, ZONA_MADRID, ZONA_MIAMI, type ReglasAgenda } from "./agenda";
import { PERFIL_MIAMI, PERFIL_POR_DEFECTO, type PerfilLegacy } from "./pricing";

/**
 * Blake trabaja en dos sitios y en cada uno cobra de forma distinta: en España en euros, en Miami «al nivel de Miami» y en
 * dólares. La primera pregunta de ManyChat es dónde está la clienta; con ella se decide el perfil de precios de Legacy, la
 * moneda, la zona horaria de la fecha que pide, las reglas de horario y días libres.
 *
 * Lo que Blake aún no haya confirmado de un sitio queda en `pendientes`: se enseña como aviso en CADA propuesta de ese sitio,
 * para que no pase por bueno algo que se ha supuesto. (Hoy no queda nada pendiente en ninguno de los dos.)
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
  /**
   * Dirección del evento por defecto. Blake a veces trabaja en sitios distintos, así que se cambia en cada cita
   * («dirección …»); null = no hay una de siempre y la propuesta pide ponerla.
   */
  direccionPorDefecto: string | null;
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
    direccionPorDefecto: "Carrer de la Duquessa de la Victòria, 16",
    pendientes: [],
  },
  miami: {
    nombre: "Miami",
    zonaHoraria: ZONA_MIAMI,
    moneda: "USD",
    // Blake: en Miami los días libres y el horario son «exactamente los mismos» que en España, pero en la hora de Miami.
    reglas: { zona: ZONA_MIAMI, diasLibres: DIAS_LIBRES, horario: HORARIO },
    perfilPorDefecto: PERFIL_MIAMI,
    clavePerfil: "perfil_legacy_miami",
    senalCentimos: 2000,
    direccionPorDefecto: null,
    pendientes: [],
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
