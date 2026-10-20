import type { EventoAgenda } from "./agenda-eventos";
import { limpiarTexto } from "./intents";
import { idDeEvento, type NuevoEvento } from "./google-calendar";
import { contextoDe, type SpecGuardada } from "./proposal";
import type { Reserva } from "./proposal-flow";
import { SIMBOLO, type Moneda } from "./ubicacion";

/**
 * El evento del calendario de una reserva, con las convenciones de Blake (copiadas de su agenda real):
 *   título       Trenzas Ana
 *   descripción  6 Trenzas / Con extensiones (rojo) / (línea en blanco) / 80€ / @instagram
 *   ubicación    la dirección de la cita
 *   aviso        ventana emergente 60 min antes · sin Google Meet
 *   color        amarillo = sin señal · morado = reservado y pagado
 * Las pruebas (/simular) llevan «🧪 PRUEBA» en el título para que no se confundan con una cita de verdad.
 */

/** Lo que Kira necesita de un calendario. La implementación real habla con Google; en las pruebas es un calendario falso. */
export interface AgendaPort {
  estado(): Promise<{ conectado: boolean; cuenta: string | null }>;
  /** TODOS los eventos entre dos instantes. Lanza si Google no responde: en ese caso NO se crea nada. */
  eventosEntre(desde: Date, hasta: Date): Promise<EventoAgenda[]>;
  crearProvisional(e: NuevoEvento): Promise<void>;
  /** Pasa a morado y, si corresponde, invita a la clienta. `invitado` dice si Google le envió la invitación. */
  pasarAPagada(eventId: string, bookingId: string, o: { email: string | null; esPrueba: boolean }): Promise<{ invitado: boolean }>;
  /** `avisarInvitados`: si la clienta ya estaba invitada, Google le envía la cancelación (por defecto, no se avisa a nadie). */
  borrar(eventId: string, bookingId: string, o?: { avisarInvitados?: boolean }): Promise<"borrado" | "ya_no_existe">;
}

const ETIQUETA_TAMANO: Record<string, string> = {
  jumbo: "Jumbo", large: "Large", lardium: "Lardium", medium: "Medium", smedium: "Smedium", small: "Small", xs_small: "XS Small",
};

/** «6 Trenzas», «4 Flat Twist», «Large braids», «Fulani Medium»: como los escribe Blake. */
export function lineaServicio(spec: SpecGuardada): string {
  const s = spec.servicio;
  let l: string;
  if (s.tipo_trenzado === "pegadas") {
    const nombre = s.estilo_pegadas === "twist" ? "Flat Twist" : s.estilo_pegadas === "barrel_twist" ? "Barrel Twist" : "Trenzas";
    l = s.numero_trenzas ? `${s.numero_trenzas} ${nombre}` : s.estilo_pegadas === "twist" || s.estilo_pegadas === "barrel_twist" ? nombre : "Trenzas pegadas";
  } else if (s.tipo_trenzado === "sueltas") {
    l = `${s.tamano ? `${ETIQUETA_TAMANO[s.tamano] ?? s.tamano} ` : ""}braids`;
    l = l.charAt(0).toUpperCase() + l.slice(1);
  } else if (s.tipo_trenzado === "fulani") {
    l = `Fulani${s.tamano ? ` ${ETIQUETA_TAMANO[s.tamano] ?? s.tamano}` : ""}`;
  } else {
    l = "Trenzas";
  }
  return s.boho ? `${l} boho` : l;
}

export function lineaExtensiones(spec: SpecGuardada): string | null {
  const e = spec.servicio.extensiones;
  if (e === "con" || e === "feedin") return `Con extensiones${spec.color_extensiones ? ` (${limpiarTexto(spec.color_extensiones, 40)})` : ""}`;
  if (e === "sin") return "Sin extensiones";
  return null;
}

/** «80€», «60,15€», «150$» (el símbolo pegado al importe, como en sus eventos). */
export function precioCorto(centimos: number, moneda: Moneda): string {
  return `${(centimos / 100).toLocaleString("es-ES", { minimumFractionDigits: centimos % 100 ? 2 : 0, useGrouping: false })}${SIMBOLO[moneda]}`;
}

export function tituloDeEvento(spec: SpecGuardada, nombre: string, prueba: boolean): string {
  const n = limpiarTexto(nombre || spec.nombre || "", 60);
  return `${prueba ? "🧪 PRUEBA · " : ""}Trenzas ${n || "(sin nombre)"}`;
}

export function descripcionDeEvento(spec: SpecGuardada, precioCents: number | null, moneda: Moneda): string {
  const cabecera = [lineaServicio(spec), lineaExtensiones(spec)].filter(Boolean).join("\n");
  const partes = [cabecera];
  if (precioCents !== null) partes.push(precioCorto(precioCents, moneda));
  const ig = spec.instagram ? `@${spec.instagram.replace(/^@/, "")}` : null;
  return `${partes.join("\n\n")}${ig ? `\n${ig}` : ""}`;
}

/** El evento de una reserva ya aprobable. Lanza si le falta el horario (nunca se crea un evento sin hora real). */
export function eventoDeReserva(r: Reserva): NuevoEvento {
  if (!r.starts_at || !r.ends_at) throw new Error("La reserva no tiene horario: no se crea el evento");
  const lugar = contextoDe(r.spec);
  return {
    id: idDeEvento(r.id),
    bookingId: r.id,
    titulo: tituloDeEvento(r.spec, r.spec.nombre ?? "", r.is_test),
    descripcion: descripcionDeEvento(r.spec, r.price_cents, lugar.moneda),
    ubicacion: r.spec.direccion ? limpiarTexto(r.spec.direccion, 200) : null,
    inicio: new Date(r.starts_at),
    fin: new Date(r.ends_at),
    zona: lugar.zonaHoraria,
    prueba: r.is_test,
  };
}
