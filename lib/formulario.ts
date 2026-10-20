import type { Clasificacion } from "./intents";
import { limpiarTexto } from "./intents";
import { leerFechaHora } from "./fecha-texto";
import type { SolicitudManychat } from "./manychat-entrada";

/**
 * El formulario de ManyChat ya trae los datos ESTRUCTURADOS (nombre, email, extensiones sí/no, color, el largo de un botón…), así que no
 * hace falta gastar Claude para leerlos (ahorro de tokens, decisión de Blake). Lo único escrito con palabras libres es la fecha y hora:
 * se lee con `leerFechaHora`; si el código no la entiende con seguridad, devuelve null y se usa Claude para ese texto.
 */

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Largo = Clasificacion["largo_extensiones"];

/** Los cuatro botones del largo → los valores de Kira (con aviso cuando no hay uno igual). */
function largoDelBoton(v: string | null): { valor: Largo; aviso?: string } {
  if (!v) return { valor: null };
  const t = sinAcentos(v);
  if (/nuca/.test(t)) return { valor: "nuca" };
  if (/media espalda/.test(t)) return { valor: "media_espalda" };
  if (/cintura/.test(t)) return { valor: "caderas", aviso: `Largo: eligió «${limpiarTexto(v, 30)}»; se ha tomado como «hasta las caderas».` };
  if (/(debajo|culo|gluteo)/.test(t)) return { valor: "mas_largo", aviso: `Largo: eligió «${limpiarTexto(v, 30)}»; se ha tomado como «más largo que las caderas».` };
  return { valor: null, aviso: `Largo: no entiendo «${limpiarTexto(v, 30)}»; míralo tú.` };
}

export function clasificacionDesdeFormulario(s: SolicitudManychat, ahora: Date, zona: string): Clasificacion | null {
  let fecha: string | null = null;
  let hora: string | null = null;
  const avisos: string[] = [];
  if (s.fechaTexto) {
    const f = leerFechaHora(s.fechaTexto, ahora, zona);
    if (!f) return null; // fecha en palabras que el código no entiende con seguridad: que la lea Claude
    fecha = f.fecha;
    hora = f.hora;
    avisos.push(...f.avisos);
  }
  const largo = largoDelBoton(s.largo);
  if (largo.aviso) avisos.push(largo.aviso);
  const extensiones = s.usoExtensiones === "si" ? "con" : s.usoExtensiones === "no" ? "sin" : null;
  return {
    intencion: "cita_salon",
    confianza: "alta",
    manipulacion: false,
    tipo_trenzado: null,
    numero_trenzas: null,
    tamano: null,
    estilo_pegadas: null,
    extensiones,
    color_extensiones: extensiones === "con" && s.colorExtensiones ? limpiarTexto(s.colorExtensiones, 60) : null,
    boho: null,
    largo_cabello: null,
    largo_extensiones: largo.valor,
    fecha,
    hora,
    nombre: s.nombre,
    email: s.email,
    instagram: s.instagram ? `@${s.instagram}` : null,
    notas: null,
    avisosValidacion: avisos,
  };
}
