import { randomUUID } from "node:crypto";
import { clasificarConClaude, leerFotosConClaude, type FotoParaLeer } from "./claude";
import { leerEstancias } from "./estancias-store";
import { crearAgendaGoogle } from "./google-agenda";
import * as fotoStore from "./foto-store";
import { resumenDeFotos, type PhotoDeps, type PhotoPort } from "./photo-flow";
import { leerBasico } from "./lectura-basica";
import * as db from "./db";
import { consultarLegacy } from "./pricing";
import type { crearClienteReal } from "./cliente-real";
import type { FlowDeps } from "./proposal-flow";
import * as store from "./proposal-store";
import * as registroStore from "./registro-store";
import { isPaused } from "./settings";
import * as tg from "./telegram";
import { detectarImagen } from "./fotos";

/** Composición real de los flujos (Supabase, Telegram, Claude, Legacy, Google): la comparten el webhook de Telegram y el de ManyChat. */

export function makePhotoDeps(): PhotoDeps {
  return {
    now: () => new Date(),
    newId: () => randomUUID(),
    conversacionReciente: fotoStore.conversacionDePruebaReciente,
    primerMensaje: fotoStore.primerMensajeDe,
    fotosDe: fotoStore.listarFotos,
    async descargar(fileId, maxBytes) {
      try {
        return { ok: true, bytes: await tg.descargarArchivo(fileId, maxBytes) };
      } catch (e) {
        if (e instanceof tg.ArchivoDemasiadoGrande) return { ok: false, motivo: "grande" };
        return { ok: false, motivo: "error", detalle: e instanceof Error ? e.message : "error desconocido" };
      }
    },
    guardar: fotoStore.guardarFoto,
    actualizarFicha: fotoStore.actualizarFicha,
    leerBytes: fotoStore.descargarBytes,
    purgarCaducadas: fotoStore.purgarCaducadas,
    enviar: tg.sendMessage,
    enviarFotos: tg.sendPhotos,
    logEvent: ({ source, ...e }) => db.logEvent(source, e),
    logSecurity: db.logSecurity,
  };
}

export function makeFlowDeps(photos: PhotoPort, cliente: ReturnType<typeof crearClienteReal>): FlowDeps {
  return {
    cliente,
    agenda: crearAgendaGoogle(),
    now: () => new Date(),
    newNonce: () => randomUUID().replace(/-/g, ""),
    clasificar: clasificarConClaude,
    // Solo /simular usa este flujo: sin clave de Claude se puede probar todo con la lectura básica.
    lecturaBasica: (texto, ahora, zona) => ({ tipo: "ok", raw: leerBasico(texto, ahora, zona), entrada: 0, salida: 0 }),
    perfil: store.perfilGuardado,
    precio: (peticion) => consultarLegacy(peticion),
    estaPausada: isPaused,
    contarLlamadasClaudeHoy: store.contarLlamadasClaudeHoy,
    crearConversacion: store.crearConversacion,
    contarMensajesClienteUltimaHora: store.contarMensajesClienteUltimaHora,
    fotosParaLeer: fotosParaLeerDe,
    leerFotos: leerFotosConClaude,
    guardarMensaje: store.guardarMensaje,
    actualizarConversacion: store.actualizarConversacion,
    crearReserva: store.crearReserva,
    actualizarReserva: store.actualizarReserva,
    leerReserva: store.leerReserva,
    marcarMensajeSospechoso: store.marcarMensajeSospechoso,
    verReservaPorNonce: store.verReservaPorNonce,
    tomarNonce: store.tomarNonce,
    reservaEnEdicion: store.reservaEnEdicion,
    estancias: leerEstancias,
    fotosDe: async (conversationId) => resumenDeFotos(await fotoStore.listarFotos(conversationId)),
    describirFoto: (conversationId, tipo, texto) => fotoStore.describirUltima(conversationId, tipo, texto, new Date()),
    enviarFotos: (chatId, conversationId) => photos.reenviar(chatId, conversationId, { silencioso: true }),
    guardarRegistro: registroStore.guardarRegistro,
    retirarRegistro: registroStore.retirarRegistro,
    listarPendientes: store.listarPendientes,
    logEvent: ({ source, ...e }) => db.logEvent(source, e),
    logSecurity: db.logSecurity,
    enviar: tg.sendMessage,
    editar: tg.editMessage,
    responderCallback: tg.answerCallback,
  };
}


/** La última foto de referencia y la última del pelo de la conversación, con sus bytes, para que Claude las lea. */
async function fotosParaLeerDe(conversationId: string): Promise<FotoParaLeer[]> {
  const guardadas = (await fotoStore.listarFotos(conversationId)).filter((f) => !f.purged_at);
  const salida: FotoParaLeer[] = [];
  for (const rol of ["referencia", "pelo"] as const) {
    const f = [...guardadas].reverse().find((x) => x.kind === rol);
    if (!f) continue;
    const bytes = await fotoStore.descargarBytes(f);
    // El tipo se vuelve a decidir por los bytes: a Claude solo llega una imagen de verdad.
    const imagen = bytes ? detectarImagen(bytes) : null;
    if (bytes && imagen) salida.push({ rol, mime: imagen.mime, bytes });
  }
  return salida;
}
