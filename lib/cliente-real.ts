import { randomUUID } from "node:crypto";
import { crearAgendaGoogle } from "./google-agenda";
import { crearFlujoCliente, type ClientePort } from "./cliente-flow";
import * as clienteStore from "./cliente-store";
import * as db from "./db";
import * as store from "./proposal-store";
import * as registroStore from "./registro-store";
import { isPaused } from "./settings";
import * as tg from "./telegram";

/** La conversación con la clienta, conectada a lo real (Telegram, Google Calendar, Supabase). Una sola instancia por petición. */
export function crearClienteReal(): ClientePort {
  const raw = process.env.TELEGRAM_ADMIN_USER_ID?.trim();
  const adminChatId = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  return crearFlujoCliente({
    now: () => new Date(),
    newNonce: () => randomUUID().replace(/-/g, ""),
    agenda: crearAgendaGoogle(),
    estaPausada: isPaused,
    leerReserva: store.leerReserva,
    actualizarReserva: store.actualizarReserva,
    verReservaPorNonce: store.verReservaPorNonce,
    tomarNonce: store.tomarNonce,
    retirarRegistro: registroStore.retirarRegistro,
    guardarMensaje: store.guardarMensaje,
    actualizarConversacion: store.actualizarConversacion,
    marcarMensajeSospechoso: store.marcarMensajeSospechoso,
    logEvent: ({ source, ...e }) => db.logEvent(source, e),
    logSecurity: db.logSecurity,
    enviar: tg.sendMessage,
    editar: tg.editMessage,
    responderCallback: tg.answerCallback,
    adminChatId,
    leerConversacion: clienteStore.leerConversacion,
    async canalEnviar(conv, texto) {
      if (conv.canal === "prueba") {
        // En las pruebas la «clienta» es Blake: el mensaje le llega a él, marcado, y no sale a ningún sitio.
        if (adminChatId === null) return { ok: false, motivo: "sin_chat_de_blake" };
        await tg.sendMessage(adminChatId, `📤 PARA LA CLIENTA (simulado: no se envía a nadie)\n\n${texto}\n\n↩️ Contesta como ella con /clienta … (por ejemplo: /clienta vale)`);
        return { ok: true };
      }
      // Instagram: se conectará con ManyChat. Mientras tanto no se escribe a nadie y Blake recibe el aviso.
      return { ok: false, motivo: "canal_no_conectado" };
    },
    bizum: clienteStore.leerBizum,
    guardarBizum: clienteStore.guardarBizum,
    avanzarFase: clienteStore.avanzarFase,
    reservaActivaDe: clienteStore.reservaActivaDe,
    reservaDePruebaActiva: clienteStore.reservaDePruebaActiva,
    vencidas: clienteStore.vencidas,
  });
}
