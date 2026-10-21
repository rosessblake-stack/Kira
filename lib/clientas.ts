import { partesEn } from "./agenda";
import { limpiarTexto } from "./intents";
import type { Reserva } from "./proposal-flow";
import { contextoDe } from "./proposal";
import { lineaServicio } from "./evento";
import type { Ubicacion } from "./ubicacion";

/**
 * Ficha de cada clienta (petición de Blake, 21-oct): Kira reconoce a quien vuelve y ManyChat no le pide otra vez nombre, email ni la
 * foto del pelo («solo dime qué estilo quieres»). Se identifica por su usuario de Instagram, que da Meta (no lo escribe ella).
 *
 * Privacidad: solo datos básicos (nombre, email, ciudad, nº de citas, último servicio). Al reconocerla, ManyChat recibe SOLO eso:
 * nunca precios, fotos ni conversaciones. Blake puede verla y borrarla (/ficha, /borrarficha). Nada de esto cambia lo que Kira
 * hace con la cita: el email y el nombre que vienen en una solicitud siguen validándose igual.
 */

export const INSTAGRAM_RE = /^[a-z0-9._]{1,30}$/;
const EMAIL_RE = /^[^\s@<>"',;()]{1,64}@[A-Za-z0-9.-]{1,80}\.[A-Za-z]{2,24}$/;
/** La foto del pelo se conserva 60 días (docs/SEGURIDAD.md): pasado ese plazo hay que pedir otra. */
export const DIAS_FOTO_PELO = 60;

export type Ficha = {
  id: string;
  instagram: string;
  nombre: string | null;
  email: string | null;
  ubicacion: Ubicacion;
  created_at: string;
  updated_at: string;
  ultima_solicitud_at: string | null;
  ultima_cita_at: string | null;
  citas_confirmadas: number;
  ultimo_servicio: string | null;
};

export type DatosFicha = { instagram: string; nombre: string | null; email: string | null; ubicacion: Ubicacion; servicio: string | null };

/** Lo que se sabe de la clienta de una reserva, ya validado. null si no hay un usuario de Instagram válido (sin él no se puede reconocer). */
export function datosDeReserva(r: Reserva): DatosFicha | null {
  const ig = (r.spec?.instagram ?? "").replace(/^@/, "").trim().toLowerCase();
  if (!INSTAGRAM_RE.test(ig)) return null;
  const email = (r.client_email ?? r.spec?.email ?? "").trim();
  const nombre = limpiarTexto(r.spec?.nombre ?? r.client_name ?? "", 60);
  return {
    instagram: ig,
    nombre: nombre && nombre !== "Cliente sin nombre" ? nombre : null,
    email: EMAIL_RE.test(email) ? email : null,
    ubicacion: contextoDe(r.spec ?? {}).ubicacion,
    // El nombre corto del servicio, como lo dice Blake («6 Flat Twist»), no la descripción larga de la propuesta.
    servicio: nombreCortoDeServicio(r),
  };
}

function nombreCortoDeServicio(r: Reserva): string | null {
  try {
    return limpiarTexto(lineaServicio(r.spec), 80) || null;
  } catch {
    return null;
  }
}

/** Normaliza lo que escribe Blake («@Marta.Trenzas») a un usuario válido, o null. */
export function normalizarInstagram(t: string): string | null {
  const ig = t.trim().replace(/^@/, "").toLowerCase();
  return INSTAGRAM_RE.test(ig) ? ig : null;
}

/** La respuesta para ManyChat: todo texto (ManyChat condiciona mejor con texto), solo lo básico y todos los campos siempre presentes. */
export type RespuestaConocer = {
  conocida: "si" | "no";
  /** El saludo ya escrito (plantilla de Kira, sin Claude): ManyChat solo lo muestra. */
  saludo: string;
  nombre: string;
  email: string;
  pais: "España" | "Miami" | "";
  citas: string;
  ultimo_servicio: string;
  pelo_guardado: "si" | "no";
};

export const NO_CONOCIDA: RespuestaConocer = { conocida: "no", saludo: "", nombre: "", email: "", pais: "", citas: "0", ultimo_servicio: "", pelo_guardado: "no" };

/**
 * «¡Hola, Marta! 🖤 Qué ganas de verte otra vez. Hace 3 semanas te hice 6 Flat Twist, ¿qué tal te quedaron? ¿Eres tú?»
 * Solo se menciona el servicio si hubo una cita confirmada y el nombre es corto y limpio (las fichas antiguas pueden traer la descripción larga).
 */
export function saludoParaClienta(f: Ficha, ahora: Date): string {
  const hola = f.nombre ? `¡Hola, ${limpiarTexto(f.nombre, 40)}!` : "¡Hola!";
  const base = `${hola} 🖤 Qué ganas de verte otra vez.`;
  const servicio = f.ultimo_servicio && f.ultimo_servicio.length <= 40 && !f.ultimo_servicio.includes("·") ? f.ultimo_servicio : null;
  if (f.citas_confirmadas < 1 || !servicio) return `${base} Te reconozco de otras veces. ¿Eres tú?`;
  const dias = f.ultima_cita_at ? Math.floor((ahora.getTime() - Date.parse(f.ultima_cita_at)) / 86_400_000) : 0;
  const cuando = dias < 7 ? "La última vez" : dias < 60 ? `Hace ${Math.round(dias / 7)} semanas` : `Hace ${Math.round(dias / 30)} meses`;
  return `${base} ${cuando} te hice ${servicio}, ¿qué tal te quedó? ¿Eres tú?`;
}

export function respuestaConocer(f: Ficha | null, peloGuardado: boolean, ahora: Date = new Date()): RespuestaConocer {
  if (!f) return NO_CONOCIDA;
  return {
    conocida: "si",
    saludo: saludoParaClienta(f, ahora),
    nombre: f.nombre ?? "",
    email: f.email ?? "",
    pais: f.ubicacion === "miami" ? "Miami" : "España",
    citas: String(f.citas_confirmadas),
    ultimo_servicio: f.ultimo_servicio ?? "",
    pelo_guardado: peloGuardado ? "si" : "no",
  };
}

export interface ClientasDeps {
  now(): Date;
  /** Crea o actualiza la ficha con lo que ya se sabe (sin pisar con vacíos). */
  guardarSolicitud(d: DatosFicha, ahora: Date): Promise<void>;
  /** Una cita confirmada: +1 y último servicio / fecha. */
  sumarCita(d: DatosFicha, fechaCita: Date | null, ahora: Date): Promise<void>;
  buscar(instagram: string): Promise<Ficha | null>;
  borrar(instagram: string): Promise<boolean>;
  /** ¿Hay una foto del pelo de esa clienta de los últimos DIAS_FOTO_PELO días? */
  hayFotoPelo(instagram: string, desde: Date): Promise<boolean>;
  enviar(chatId: number, texto: string): Promise<unknown>;
  logEvent(e: { source: "system" | "telegram"; kind: string; level?: "info" | "warn" | "error"; summary: string; detail?: Record<string, unknown> }): Promise<void>;
}

export interface ClientasPort {
  alAprobar(r: Reserva): Promise<void>;
  alConfirmarCita(r: Reserva): Promise<void>;
  /** Para ManyChat: ¿la conocemos? Solo datos básicos. */
  conocer(instagram: string): Promise<RespuestaConocer>;
  /** /ficha @usuario */
  ver(chatId: number, texto: string): Promise<void>;
  /** /borrarficha @usuario */
  borrar(chatId: number, texto: string): Promise<void>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "error desconocido");

export function crearFlujoClientas(deps: ClientasDeps): ClientasPort {
  /** Una ficha que no se puede guardar nunca rompe la cita: queda en Fallos. */
  async function seguro(que: string, f: () => Promise<void>) {
    try {
      await f();
    } catch (e) {
      await deps.logEvent({ source: "system", kind: "ficha_fallo", level: "warn", summary: `No se pudo ${que}: ${msg(e)}` }).catch(() => undefined);
    }
  }

  async function alAprobar(r: Reserva) {
    const d = datosDeReserva(r);
    if (!d || r.is_test) return;
    await seguro("guardar la ficha de la clienta", () => deps.guardarSolicitud(d, deps.now()));
  }

  async function alConfirmarCita(r: Reserva) {
    const d = datosDeReserva(r);
    if (!d || r.is_test) return;
    await seguro("anotar la cita en la ficha", () => deps.sumarCita(d, r.starts_at ? new Date(r.starts_at) : null, deps.now()));
  }

  async function conocer(instagram: string): Promise<RespuestaConocer> {
    const ig = normalizarInstagram(instagram);
    if (!ig) return NO_CONOCIDA;
    const f = await deps.buscar(ig);
    if (!f) return NO_CONOCIDA;
    const desde = new Date(deps.now().getTime() - DIAS_FOTO_PELO * 86_400_000);
    const pelo = await deps.hayFotoPelo(ig, desde).catch(() => false);
    await deps.logEvent({ source: "system", kind: "clienta_reconocida", summary: "Una clienta que vuelve ha sido reconocida", detail: { citas: f.citas_confirmadas, pelo_guardado: pelo } }).catch(() => undefined);
    return respuestaConocer(f, pelo, deps.now());
  }

  const fecha = (iso: string | null) => {
    if (!iso) return "—";
    const [a, m, d] = partesEn(new Date(iso)).fecha.split("-");
    return `${d}/${m}/${a}`;
  };

  async function ver(chatId: number, texto: string) {
    const ig = normalizarInstagram(texto.replace(/^\/ficha(?:@\w+)?/i, ""));
    if (!ig) {
      await deps.enviar(chatId, "Dime de quién: /ficha @usuario_de_instagram");
      return;
    }
    const f = await deps.buscar(ig);
    if (!f) {
      await deps.enviar(chatId, `No tengo ficha de @${ig}. Se crea cuando apruebas su primera cita.`);
      return;
    }
    await deps.enviar(
      chatId,
      `🗂 Ficha de @${f.instagram}\n• Nombre: ${f.nombre ?? "—"}\n• Email: ${f.email ?? "—"}\n• Ciudad: ${f.ubicacion === "miami" ? "Miami" : "España"}\n• Citas confirmadas: ${f.citas_confirmadas}\n• Última cita: ${fecha(f.ultima_cita_at)}${f.ultimo_servicio ? ` (${f.ultimo_servicio})` : ""}\n• Primera vez: ${fecha(f.created_at)}\n\nPara borrarla: /borrarficha @${f.instagram}`,
    );
  }

  async function borrar(chatId: number, texto: string) {
    const ig = normalizarInstagram(texto.replace(/^\/borrarficha(?:@\w+)?/i, ""));
    if (!ig) {
      await deps.enviar(chatId, "Dime de quién: /borrarficha @usuario_de_instagram");
      return;
    }
    const ok = await deps.borrar(ig);
    if (ok) await deps.logEvent({ source: "telegram", kind: "ficha_borrada", level: "warn", summary: "Blake borró la ficha de una clienta" });
    await deps.enviar(
      chatId,
      ok ? `🗑 Ficha de @${ig} borrada. La próxima vez que escriba, Kira le volverá a pedir todo. (Sus citas y fotos antiguas siguen en el historial; si quiere que se borren también, dímelo.)` : `No tengo ficha de @${ig}.`,
    );
  }

  return { alAprobar, alConfirmarCita, conocer, ver, borrar };
}
