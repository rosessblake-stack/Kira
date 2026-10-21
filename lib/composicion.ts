import { contarSolicitudesDia, leerLimiteDia } from "./limite-solicitudes";
import { randomUUID } from "node:crypto";
import { clasificarConClaude, leerFotosConClaude, type EjemploParaClaude, type FotoParaLeer } from "./claude";
import { EJEMPLOS_POR_ESTILO_A_CLAUDE, NOMBRE_ESTILO_EJEMPLO, type EjemplosDeps } from "./ejemplos";
import * as ejemplosStore from "./ejemplos-store";
import { crearFlujoClientas, type ClientasDeps } from "./clientas";
import * as clientasStore from "./clientas-store";
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
import { reducirParaClaude } from "./imagen-ligera";

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
    fichas: crearFlujoClientas(makeClientasDeps()),
    ofrecerEjemplosDeEstilo: true,
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
    limiteSolicitudesDia: leerLimiteDia,
    contarSolicitudesDia,
    fotosParaLeer: fotosParaLeerDe,
    leerFotos: async (fotos) => leerFotosConClaude(fotos, await ejemplosParaClaude()),
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
    enviarFotos: (chatId, conversationId) => photos.reenviar(chatId, conversationId, { silencioso: true, recientes: true }),
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


/**
 * La foto de referencia (y, solo si Blake lo desbloquea con KIRA_LEER_PELO=1, la del pelo) de la conversación, ya REDUCIDA, para que
 * Claude la lea. Decisión de Blake (20-oct, ahorro de tokens): el pelo lo mira y lo describe él; la foto le llega igualmente a Telegram.
 */
export const leerFotoDelPelo = () => process.env.KIRA_LEER_PELO === "1";

async function fotosParaLeerDe(conversationId: string): Promise<FotoParaLeer[]> {
  const guardadas = (await fotoStore.listarFotos(conversationId)).filter((f) => !f.purged_at);
  const salida: FotoParaLeer[] = [];
  for (const rol of leerFotoDelPelo() ? (["referencia", "pelo"] as const) : (["referencia"] as const)) {
    const f = [...guardadas].reverse().find((x) => x.kind === rol);
    if (!f) continue;
    const bytes = await fotoStore.descargarBytes(f);
    // El tipo se vuelve a decidir por los bytes y la imagen se reduce: a Claude solo llega una imagen de verdad, pequeña.
    if (!bytes || !detectarImagen(bytes)) continue;
    const ligera = await reducirParaClaude(bytes);
    if (ligera) salida.push({ rol, mime: ligera.mime, bytes: ligera.bytes });
  }
  return salida;
}


// ---------------------------------------------------------------------------
// Ejemplos de estilo etiquetados por Blake (se le enseñan a Claude junto a la foto de la clienta)
// ---------------------------------------------------------------------------

const CACHE_EJEMPLOS_MS = 5 * 60_000;
let cacheEjemplos: { hasta: number; lista: EjemploParaClaude[] } | null = null;

export const invalidarCacheEjemplos = () => {
  cacheEjemplos = null;
};

/** Los últimos ejemplos de cada estilo, reducidos a 512 px (una imagen pequeña cuesta ~350 tokens). Si falla algo, se lee sin ejemplos. */
async function ejemplosParaClaude(): Promise<EjemploParaClaude[]> {
  if (cacheEjemplos && cacheEjemplos.hasta > Date.now()) return cacheEjemplos.lista;
  try {
    const lista: EjemploParaClaude[] = [];
    for (const e of await ejemplosStore.cargarEjemplosParaClaude(EJEMPLOS_POR_ESTILO_A_CLAUDE)) {
      const ligera = await reducirParaClaude(e.bytes, 512);
      if (ligera) lista.push({ estilo: NOMBRE_ESTILO_EJEMPLO[e.estilo], mime: ligera.mime, bytes: ligera.bytes });
    }
    cacheEjemplos = { hasta: Date.now() + CACHE_EJEMPLOS_MS, lista };
    return lista;
  } catch {
    return [];
  }
}

export function makeEjemplosDeps(): EjemplosDeps {
  return {
    newId: () => randomUUID(),
    async descargar(fileId, maxBytes) {
      try {
        return { ok: true, bytes: await tg.descargarArchivo(fileId, maxBytes) };
      } catch (e) {
        return { ok: false, motivo: e instanceof tg.ArchivoDemasiadoGrande ? "grande" : "error" };
      }
    },
    async fotoReferenciaDeReserva(reservaId) {
      const { data } = await db.getDb().from("bookings").select("conversation_id").eq("id", reservaId).maybeSingle();
      const conv = (data as { conversation_id: string | null } | null)?.conversation_id;
      if (!conv) return null;
      const f = [...(await fotoStore.listarFotos(conv))].reverse().find((x) => x.kind === "referencia" && !x.purged_at);
      return f ? fotoStore.descargarBytes(f) : null;
    },
    guardar: ejemplosStore.guardarEjemplo,
    contarPorEstilo: ejemplosStore.contarEjemplosPorEstilo,
    listar: ejemplosStore.listarEjemplos,
    borrar: ejemplosStore.borrarEjemplo,
    invalidarCache: invalidarCacheEjemplos,
    enviar: tg.sendMessage,
    logEvent: ({ source, ...e }) => db.logEvent(source, e),
  };
}

export function makeClientasDeps(): ClientasDeps {
  return {
    now: () => new Date(),
    guardarSolicitud: clientasStore.guardarSolicitud,
    sumarCita: clientasStore.sumarCita,
    buscar: clientasStore.buscarFicha,
    borrar: clientasStore.borrarFicha,
    hayFotoPelo: clientasStore.hayFotoPelo,
    enviar: tg.sendMessage,
    logEvent: ({ source, ...e }) => db.logEvent(source, e),
  };
}
