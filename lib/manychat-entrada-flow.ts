import type { ResultadoDescarga } from "./descarga-segura";
import type { SolicitudManychat } from "./manychat-entrada";
import type { PhotoPort } from "./photo-flow";
import type { ProposalPort } from "./proposal-flow";

/**
 * La solicitud que llega de ManyChat al terminar el flujo «cita / agendar», de principio a fin y en MODO SOMBRA (decisión de Blake):
 * Kira descarga las fotos, las guarda, las lee, calcula el precio y le manda a Blake la propuesta con las fotos. A la clienta NO se le
 * escribe: Blake le contesta como siempre. Las fotos se descargan de forma segura (solo dominios de Meta/ManyChat, con topes).
 */

export interface EntradaDeps {
  proposals: Pick<ProposalPort, "recibirSolicitud">;
  photos: Pick<PhotoPort, "guardarDeClienta">;
  descargar(direccion: string): Promise<ResultadoDescarga>;
  /**
   * Clienta que vuelve (ManyChat se saltó la pregunta de la foto del pelo): la foto del pelo de su última solicitud, si sigue guardada
   * (60 días). null = no hay.
   */
  fotoPeloAnterior?(instagram: string): Promise<Uint8Array | null>;
  /** Chat de Blake. */
  chatIdAdmin: number;
  enviar(chatId: number, texto: string): Promise<unknown>;
  logEvent(e: { kind: string; level?: "info" | "warn" | "error"; summary: string; detail?: Record<string, unknown>; conversation_id?: string | null }): Promise<void>;
}

export interface EntradaPort {
  procesar(s: SolicitudManychat): Promise<void>;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : "error desconocido");

export function crearEntradaManychat(deps: EntradaDeps): EntradaPort {
  async function traerFoto(convId: string, tipo: "pelo" | "referencia", url: string | null, claves?: string[]) {
    if (!url) {
      // Se anotan los NOMBRES de los campos que sí llegaron: así se ve si ManyChat mandó el campo de la foto vacío o con otro nombre.
      await deps.logEvent({ kind: "foto_ausente", level: "warn", summary: `La solicitud no trae foto de ${tipo === "pelo" ? "pelo" : "referencia"}`, detail: { campos_recibidos: claves ?? [] }, conversation_id: convId });
      return;
    }
    const d = await deps.descargar(url);
    if (!d.ok) {
      // Solo el dominio: la dirección completa puede llevar un permiso temporal.
      await deps.logEvent({ kind: "foto_descarga_fallo", level: "warn", summary: `No se pudo descargar la foto de ${tipo === "pelo" ? "pelo" : "referencia"} (${d.motivo}${d.dominio ? `, ${d.dominio}` : ""})`, detail: { motivo: d.motivo, dominio: d.dominio ?? null }, conversation_id: convId });
      return;
    }
    await deps.photos.guardarDeClienta(convId, tipo, d.bytes);
  }

  /** La foto del pelo: la de esta solicitud o, si no viene y la clienta ya nos la dio hace menos de 60 días, la anterior. */
  async function peloDe(convId: string, s: SolicitudManychat) {
    if (!s.fotoPeloUrl && s.instagram && deps.fotoPeloAnterior) {
      try {
        const bytes = await deps.fotoPeloAnterior(s.instagram.toLowerCase());
        if (bytes) {
          const g = await deps.photos.guardarDeClienta(convId, "pelo", bytes);
          if (g.ok) {
            await deps.logEvent({ kind: "foto_pelo_reutilizada", summary: "Clienta que vuelve: se reutiliza la foto de su pelo (menos de 60 días)", conversation_id: convId });
            return;
          }
        }
      } catch (e) {
        await deps.logEvent({ kind: "foto_pelo_reutilizar_fallo", level: "warn", summary: msg(e), conversation_id: convId });
      }
    }
    await traerFoto(convId, "pelo", s.fotoPeloUrl, s.claves);
  }

  async function procesar(s: SolicitudManychat): Promise<void> {
    try {
      await deps.proposals.recibirSolicitud(deps.chatIdAdmin, s, async (convId) => {
        // Las dos fotos a la vez; un fallo con una no impide la propuesta (queda en Fallos y la propuesta avisa de que falta).
        await Promise.all([traerFoto(convId, "referencia", s.fotoReferenciaUrl, s.claves), peloDe(convId, s)]);
      });
    } catch (e) {
      await deps.logEvent({ kind: "solicitud_fallo", level: "error", summary: msg(e) });
      await deps
        .enviar(deps.chatIdAdmin, `⚠️ Ha llegado una solicitud de Instagram${s.instagram ? ` (@${s.instagram})` : ""} pero no he podido prepararla (fallo técnico). Mira Fallos en el panel; la clienta no ha recibido nada.`)
        .catch(() => undefined);
    }
  }

  return { procesar };
}
