import { describe, expect, it } from "vitest";
import {
  PLAZO_PAGO_MIN,
  PLAZO_PRECIO_HORAS,
  VENTANA_MS,
  esAceptacion,
  esConfirmado,
  normalizar,
  normalizarBizum,
  textoConfirmada,
  textoLiberada,
  textoPagoPedido,
  textoRevertida,
  ventanaAbierta,
} from "../lib/clienta";
import type { Reserva } from "../lib/proposal-flow";

const reserva = (o: Partial<Reserva> = {}): Reserva =>
  ({
    id: "r1", conversation_id: "c1", client_name: "Michael", client_email: "michal@gmail.com", service_description: "6 trenzas",
    price_cents: 6000, deposit_cents: 2000, duration_minutes: 150, starts_at: "2026-10-24T10:00:00.000Z", ends_at: "2026-10-24T12:30:00.000Z",
    status: "pendiente_pago", spec: { nombre: "Michael", ubicacion: "espana", direccion: "Carrer de la Duquessa de la Victòria, 16" }, pricing: {}, warnings: [],
    reply_draft: null, proposal_nonce: null, telegram_message_id: null, edit_requested_at: null, is_test: false, approved_by_telegram_user: null, approved_at: null,
    ...o,
  }) as unknown as Reserva;

describe("normalizar", () => {
  it("quita acentos, signos y mayúsculas", () => {
    expect(normalizar("¡Vale, gracias!")).toBe("vale gracias");
    expect(normalizar("  SÍÍ  ")).toBe("sii");
    expect(normalizar("Ya lo pagué…")).toBe("ya lo pague");
  });
});

describe("esAceptacion: un sí al precio", () => {
  it("entiende las formas normales de decir que sí", () => {
    for (const t of ["vale", "Vale!", "ok", "OK 👍", "okey", "sí", "Si, por favor", "perfecto", "¡Genial!", "de acuerdo", "me parece bien", "dale", "claro que sí", "listo", "ok gracias", "Vale perfecto"]) {
      expect(esAceptacion(t), t).toBe(true);
    }
  });
  it("un pulgar solo también vale", () => {
    expect(esAceptacion("👍")).toBe(true);
    expect(esAceptacion("👌👌")).toBe(true);
    expect(esAceptacion("😊")).toBe(false);
  });
  it("«confirmo» al precio es un sí, pero no tras pedir el Bizum", () => {
    expect(esAceptacion("confirmado", true)).toBe(true);
    expect(esAceptacion("Confirmo", true)).toBe(true);
    expect(esAceptacion("confirmado", false)).toBe(false);
  });
  it("nada que lleve más cosas, condiciones o preguntas cuenta como sí", () => {
    for (const t of ["vale pero cuesta mucho", "ok, ¿y si lo dejo en 50?", "no", "no vale", "vale?", "no gracias", "me lo pienso", "ok pero otro día", "", "   "]) {
      expect(esAceptacion(t), t).toBe(false);
    }
    expect(esAceptacion("vale ".repeat(40))).toBe(false);
  });
});

describe("esConfirmado: dice que ya hizo el Bizum", () => {
  it("entiende «confirmado» y sus formas más comunes", () => {
    for (const t of ["confirmado", "Confirmado!", "confirmada", "Confirmado 👍", "hecho", "ya está", "ya lo hice", "Ya lo he hecho", "pagado", "ya pagué", "bizum hecho", "enviado", "listo", "Hecho el bizum"]) {
      expect(esConfirmado(t), t).toBe(true);
    }
  });
  it("una frase con «confirmado» dentro que dice otra cosa NO confirma", () => {
    for (const t of ["no he confirmado todavía", "aún no está confirmado", "no confirmado", "cuando lo tenga confirmado te aviso", "¿está confirmado?", "no he pagado", "ya lo haré", "mañana lo hago", "vale", "ok"]) {
      expect(esConfirmado(t), t).toBe(false);
    }
  });
  it("un mensaje larguísimo nunca confirma", () => {
    expect(esConfirmado(`confirmado ${"x".repeat(200)}`)).toBe(false);
  });
});

describe("ventana de 24 h de Instagram", () => {
  const ahora = new Date("2026-10-20T12:00:00Z");
  it("abierta si escribió hace menos de ~24 h", () => {
    expect(ventanaAbierta("2026-10-20T11:59:00Z", ahora)).toBe(true);
    expect(ventanaAbierta(new Date(ahora.getTime() - VENTANA_MS).toISOString(), ahora)).toBe(true);
  });
  it("cerrada si pasó el plazo, si no hay dato o si el dato es raro", () => {
    expect(ventanaAbierta(new Date(ahora.getTime() - VENTANA_MS - 1000).toISOString(), ahora)).toBe(false);
    expect(ventanaAbierta(null, ahora)).toBe(false);
    expect(ventanaAbierta("no es una fecha", ahora)).toBe(false);
    expect(ventanaAbierta("2026-10-21T12:00:00Z", ahora)).toBe(false); // en el futuro: no se fía
  });
});

describe("número de Bizum", () => {
  it("acepta un móvil español de 9 cifras en distintos formatos", () => {
    for (const t of ["662018425", "662 01 84 25", "+34 662 018 425", "0034662018425", "662-018-425"]) expect(normalizarBizum(t), t).toBe("662018425");
  });
  it("rechaza lo que no lo es", () => {
    for (const t of ["", "12345", "562018425", "66201842", "6620184255", "hola", "+1 305 555 0100"]) expect(normalizarBizum(t), t).toBeNull();
  });
});

describe("plantillas para la clienta", () => {
  it("los plazos son los que dijo Blake", () => {
    expect(PLAZO_PRECIO_HORAS).toBe(20);
    expect(PLAZO_PAGO_MIN).toBe(45);
  });

  it("pago pedido: Bizum de 20 € al número de Blake, se descuenta del total, resto en efectivo, «confirmado» y plazo", () => {
    const t = textoPagoPedido(reserva(), "662018425");
    expect(t).toContain("Bizum de 20 € al 662018425");
    expect(t).toContain("se descuentan del total");
    expect(t).toContain("el resto lo pagas en efectivo");
    expect(t).toContain("«confirmado»");
    expect(t).toContain("45 minutos");
    expect(t).toContain("sáb 24 oct, 12:00");
  });

  it("confirmada: fecha, duración, dirección y, si hubo invitación, el email", () => {
    const t = textoConfirmada(reserva(), true);
    expect(t).toContain("Tu cita queda reservada");
    expect(t).toContain("2 h 30 min");
    expect(t).toContain("invitación a michal@gmail.com");
    expect(t).toContain("Carrer de la Duquessa de la Victòria, 16");
    expect(textoConfirmada(reserva(), false)).not.toContain("invitación");
  });

  it("liberada y revertida: avisan sin culpar y dejan la puerta abierta", () => {
    expect(textoLiberada()).toContain("liberado el hueco");
    expect(textoRevertida()).toContain("escríbeme");
  });
});
