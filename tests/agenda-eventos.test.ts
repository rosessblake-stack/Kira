import { describe, expect, it } from "vitest";
import { ZONA_MADRID, ZONA_MIAMI, aUtc } from "../lib/agenda";
import {
  avisosDeHueco,
  describirEvento,
  evaluarHueco,
  interpretarEventoGoogle,
  textoAgendaDelDia,
  textoChoques,
  type EventoAgenda,
} from "../lib/agenda-eventos";

/** Eventos con la forma real que devuelve Google Calendar (copiados de la agenda de Blake, con otros nombres). */
const cita = {
  id: "0ankhribqdb1kgs35s2lu5mehi", status: "confirmed", summary: "Trenzas Yeray", colorId: "3",
  description: "6 Trenzas\nCon extensiones (Negro 1B)\n\n60€\nyeraymc_", location: "Carrer de la Duquessa de la Victòria, 16",
  start: { dateTime: "2026-10-30T11:30:00+01:00", timeZone: "Europe/Madrid" }, end: { dateTime: "2026-10-30T13:30:00+01:00", timeZone: "Europe/Madrid" },
};
const lux = {
  id: "16liu82337ucks07je0sqjrc0n", status: "confirmed", summary: "Trenzas Lux", transparency: "transparent", colorId: "3",
  start: { dateTime: "2026-10-27T14:00:00+01:00", timeZone: "Europe/Madrid" }, end: { dateTime: "2026-10-27T17:00:00+01:00", timeZone: "Europe/Madrid" },
};
const viaje = {
  id: "0i669p7n10l1b665bj49cs1l47", status: "confirmed", summary: "ALICANTE ", transparency: "transparent",
  start: { date: "2026-10-31" }, end: { date: "2026-11-03" },
};

const ev = (raw: unknown) => interpretarEventoGoogle(raw)!;
const at = (fecha: string, hora: string, zona = ZONA_MADRID) => aUtc(fecha, hora, zona);

describe("interpretarEventoGoogle", () => {
  it("una cita con hora: título, inicio y fin reales", () => {
    const e = ev(cita);
    expect(e).toMatchObject({ id: "0ankhribqdb1kgs35s2lu5mehi", titulo: "Trenzas Yeray", libre: false, esDeKira: false, esPrueba: false, dias: null, bookingId: null });
    expect(e.inicio!.toISOString()).toBe("2026-10-30T10:30:00.000Z");
    expect(e.fin!.toISOString()).toBe("2026-10-30T12:30:00.000Z");
  });

  it("marcado «libre» (transparente): se lee como libre, pero sigue siendo un evento", () => {
    expect(ev(lux)).toMatchObject({ libre: true, titulo: "Trenzas Lux" });
  });

  it("de todo el día: guarda las fechas, sin horas", () => {
    expect(ev(viaje)).toMatchObject({ titulo: "ALICANTE", inicio: null, fin: null, dias: { desde: "2026-10-31", hasta: "2026-11-03" }, libre: true });
  });

  it("las fechas de todo el día llegan a veces como «2026-11-03T00:00:00Z»: se lee solo la fecha", () => {
    const e = ev({ id: "a", start: { date: "2026-10-31T00:00:00Z" }, end: { date: "2026-11-03T00:00:00Z" }, summary: "x" });
    expect(e.dias).toEqual({ desde: "2026-10-31", hasta: "2026-11-03" });
  });

  it("un evento creado por Kira lleva su marca; una prueba, también", () => {
    const k = ev({ ...cita, id: "kiraab", extendedProperties: { private: { kira_booking_id: "res-1" } } });
    expect(k).toMatchObject({ esDeKira: true, bookingId: "res-1", esPrueba: false });
    const p = ev({ ...cita, id: "kiracd", extendedProperties: { private: { kira_booking_id: "res-2", kira_test: "1" } } });
    expect(p).toMatchObject({ esDeKira: true, esPrueba: true });
  });

  it("los cancelados y lo que no se entiende se descartan (no se inventa nada)", () => {
    expect(interpretarEventoGoogle({ ...cita, status: "cancelled" })).toBeNull();
    expect(interpretarEventoGoogle(null)).toBeNull();
    expect(interpretarEventoGoogle("hola")).toBeNull();
    expect(interpretarEventoGoogle({ id: "x" })).toBeNull();
    expect(interpretarEventoGoogle({ id: "x", start: { dateTime: "no-es-fecha" }, end: { dateTime: "tampoco" } })).toBeNull();
    expect(interpretarEventoGoogle({ start: cita.start, end: cita.end })).toBeNull();
  });

  it("el título se limpia (sin control ni saltos) y se recorta", () => {
    expect(ev({ ...cita, summary: `Hola\u0000\n  mundo ${"x".repeat(200)}` }).titulo.length).toBeLessThanOrEqual(80);
    expect(ev({ ...cita, summary: "  " }).titulo).toBe("(sin título)");
    expect(ev({ ...cita, summary: undefined }).titulo).toBe("(sin título)");
  });
});

describe("evaluarHueco: lo que bloquea", () => {
  const eventos = [ev(cita), ev(lux), ev(viaje)];

  it("un hueco limpio no tiene choques", () => {
    const h = evaluarHueco(at("2026-10-28", "12:00"), at("2026-10-28", "15:00"), eventos, ZONA_MADRID);
    expect(h.choques).toEqual([]);
  });

  it("choca con una cita marcada «libre» (el caso Lux): bloquea y lo explica", () => {
    const h = evaluarHueco(at("2026-10-27", "15:00"), at("2026-10-27", "18:00"), eventos, ZONA_MADRID);
    expect(h.choques.map((e) => e.titulo)).toEqual(["Trenzas Lux"]);
    expect(textoChoques(h, ZONA_MADRID)).toEqual(["hueco ocupado por «Trenzas Lux» 14:00–17:00 (marcado «libre» en tu calendario, pero cuenta)"]);
  });

  it("usa la hora de fin REAL: empezar justo cuando acaba otra no choca; un minuto antes sí", () => {
    expect(evaluarHueco(at("2026-10-27", "17:00"), at("2026-10-27", "19:00"), eventos, ZONA_MADRID).choques).toEqual([]);
    expect(evaluarHueco(at("2026-10-27", "16:59"), at("2026-10-27", "19:00"), eventos, ZONA_MADRID).choques).toHaveLength(1);
  });

  it("una cita que contiene a otra, o está dentro de otra, choca", () => {
    expect(evaluarHueco(at("2026-10-27", "13:00"), at("2026-10-27", "18:00"), eventos, ZONA_MADRID).choques).toHaveLength(1);
    expect(evaluarHueco(at("2026-10-27", "15:00"), at("2026-10-27", "16:00"), eventos, ZONA_MADRID).choques).toHaveLength(1);
  });

  it("un evento de todo el día NO bloquea, pero se avisa", () => {
    const h = evaluarHueco(at("2026-11-01", "12:00"), at("2026-11-01", "15:00"), eventos, ZONA_MADRID);
    expect(h.choques).toEqual([]);
    expect(h.todoElDia.map((e) => e.titulo)).toEqual(["ALICANTE"]);
    expect(avisosDeHueco(h, ZONA_MADRID)).toEqual(["Ese día tienes un evento de todo el día: «ALICANTE»."]);
    // el día en que ya no ocupa (hasta es exclusivo)
    expect(evaluarHueco(at("2026-11-03", "12:00"), at("2026-11-03", "15:00"), eventos, ZONA_MADRID).todoElDia).toEqual([]);
  });

  it("cuenta aunque Blake haya «rechazado» el evento como invitado (sigue siendo una cita suya)", () => {
    const rechazado = ev({ ...cita, id: "judith", attendees: [{ email: "yo@x.com", self: true, responseStatus: "declined" }], summary: "Trenzas Judith" });
    const h = evaluarHueco(at("2026-10-30", "12:00"), at("2026-10-30", "14:00"), [rechazado], ZONA_MADRID);
    expect(h.choques).toHaveLength(1);
  });

  it("las pruebas de Kira no bloquean; los eventos reales de Kira sí", () => {
    const prueba = ev({ ...cita, id: "kiraprueba", extendedProperties: { private: { kira_booking_id: "res-9", kira_test: "1" } } });
    const real = ev({ ...cita, id: "kirareal", extendedProperties: { private: { kira_booking_id: "res-8" } } });
    expect(evaluarHueco(at("2026-10-30", "12:00"), at("2026-10-30", "14:00"), [prueba], ZONA_MADRID).choques).toEqual([]);
    expect(evaluarHueco(at("2026-10-30", "12:00"), at("2026-10-30", "14:00"), [real], ZONA_MADRID).choques).toHaveLength(1);
  });

  it("al volver a comprobar una reserva, su propio evento no cuenta como choque", () => {
    const propio = ev({ ...cita, id: "kiraprop", extendedProperties: { private: { kira_booking_id: "res-7" } } });
    expect(evaluarHueco(at("2026-10-30", "12:00"), at("2026-10-30", "14:00"), [propio], ZONA_MADRID, { excluirBookingId: "res-7" }).choques).toEqual([]);
    expect(evaluarHueco(at("2026-10-30", "12:00"), at("2026-10-30", "14:00"), [propio], ZONA_MADRID, { excluirBookingId: "res-otra" }).choques).toHaveLength(1);
  });

  it("un evento de duración cero solo choca si cae dentro de la cita", () => {
    const punto = ev({ id: "p", summary: "Recordatorio", start: { dateTime: "2026-10-28T13:00:00+01:00" }, end: { dateTime: "2026-10-28T13:00:00+01:00" } });
    expect(evaluarHueco(at("2026-10-28", "12:00"), at("2026-10-28", "14:00"), [punto], ZONA_MADRID).choques).toHaveLength(1);
    expect(evaluarHueco(at("2026-10-28", "13:00"), at("2026-10-28", "14:00"), [punto], ZONA_MADRID).choques).toEqual([]);
  });

  it("choca con un evento que cruza la medianoche", () => {
    const noche = ev({ id: "n", summary: "Cena", start: { dateTime: "2026-10-28T22:00:00+01:00" }, end: { dateTime: "2026-10-29T01:00:00+01:00" } });
    expect(evaluarHueco(at("2026-10-29", "00:30"), at("2026-10-29", "02:00"), [noche], ZONA_MADRID).choques).toHaveLength(1);
  });

  it("sin eventos no hay choques ni contiguas", () => {
    const h = evaluarHueco(at("2026-10-28", "12:00"), at("2026-10-28", "15:00"), [], ZONA_MADRID);
    expect(h).toMatchObject({ choques: [], anterior: null, siguiente: null, todoElDia: [], delDia: [] });
  });
});

describe("evaluarHueco: márgenes y contiguas", () => {
  const manana = ev({ id: "m", summary: "Trenzas Cata", start: { dateTime: "2026-10-28T11:00:00+01:00" }, end: { dateTime: "2026-10-28T13:00:00+01:00" } });
  const tarde = ev({ id: "t", summary: "Asesoría Dani", start: { dateTime: "2026-10-28T17:30:00+01:00" }, end: { dateTime: "2026-10-28T18:30:00+01:00" } });

  it("calcula el margen con la anterior y la siguiente", () => {
    const h = evaluarHueco(at("2026-10-28", "14:30"), at("2026-10-28", "16:30"), [manana, tarde], ZONA_MADRID);
    expect(h.anterior).toMatchObject({ margenMin: 90 });
    expect(h.anterior!.evento.titulo).toBe("Trenzas Cata");
    expect(h.siguiente).toMatchObject({ margenMin: 60 });
    expect(avisosDeHueco(h, ZONA_MADRID)).toEqual([]); // 1 h o más: nada que avisar
  });

  it("un margen de menos de 1 h avisa (blando): con la anterior y con la siguiente", () => {
    const h = evaluarHueco(at("2026-10-28", "13:30"), at("2026-10-28", "17:00"), [manana, tarde], ZONA_MADRID);
    expect(avisosDeHueco(h, ZONA_MADRID)).toEqual([
      "Margen de 30 min con la cita anterior («Trenzas Cata» 11:00–13:00); lo habitual es 1 h.",
      "Margen de 30 min con la cita siguiente («Asesoría Dani» 17:30–18:30); lo habitual es 1 h.",
    ]);
  });

  it("el margen es configurable (servicios fáciles)", () => {
    const h = evaluarHueco(at("2026-10-28", "13:30"), at("2026-10-28", "17:00"), [manana, tarde], ZONA_MADRID, { margenMin: 30 });
    expect(avisosDeHueco(h, ZONA_MADRID)).toEqual([]);
  });

  it("pegada a otra cita (margen 0) también avisa", () => {
    const h = evaluarHueco(at("2026-10-28", "13:00"), at("2026-10-28", "15:00"), [manana], ZONA_MADRID);
    expect(h.anterior!.margenMin).toBe(0);
    expect(avisosDeHueco(h, ZONA_MADRID)[0]).toContain("Margen de 0 min");
  });

  it("si choca, no habla de márgenes (lo importante es el choque)", () => {
    const h = evaluarHueco(at("2026-10-28", "12:00"), at("2026-10-28", "15:00"), [manana], ZONA_MADRID);
    expect(h.choques).toHaveLength(1);
    expect(avisosDeHueco(h, ZONA_MADRID)).toEqual([]);
  });
});

describe("textoAgendaDelDia", () => {
  const manana = ev({ id: "m", summary: "Trenzas Cata", start: { dateTime: "2026-10-28T11:00:00+01:00" }, end: { dateTime: "2026-10-28T13:00:00+01:00" } });
  const tarde = ev({ id: "t", summary: "Asesoría Dani", start: { dateTime: "2026-10-28T17:30:00+01:00" }, end: { dateTime: "2026-10-28T18:30:00+01:00" } });

  it("la cita nueva en su sitio entre las demás, con los márgenes", () => {
    const i = at("2026-10-28", "14:30"), f = at("2026-10-28", "16:30");
    const h = evaluarHueco(i, f, [manana, tarde], ZONA_MADRID);
    expect(textoAgendaDelDia(h, i, f, ZONA_MADRID, "mié 28 oct")).toEqual([
      "📅 Tu agenda ese día (mié 28 oct)",
      "• 11:00–13:00 Trenzas Cata",
      "• 14:30–16:30 ◀ esta cita",
      "• 17:30–18:30 Asesoría Dani",
      "Margen con la anterior: 1 h 30 min · con la siguiente: 1 h",
    ]);
  });

  it("los choques salen marcados y los libres, también", () => {
    const i = at("2026-10-27", "15:00"), f = at("2026-10-27", "18:00");
    const h = evaluarHueco(i, f, [ev(lux)], ZONA_MADRID);
    const t = textoAgendaDelDia(h, i, f, ZONA_MADRID, "mar 27 oct").join("\n");
    expect(t).toContain("14:00–17:00 Trenzas Lux  ⛔ CHOCA (libre)");
    expect(t).not.toContain("Margen");
  });

  it("sin otras citas lo dice", () => {
    const i = at("2026-10-28", "12:00"), f = at("2026-10-28", "15:00");
    const h = evaluarHueco(i, f, [], ZONA_MADRID);
    expect(textoAgendaDelDia(h, i, f, ZONA_MADRID, "mié 28 oct")).toContain("Sin otras citas ese día.");
  });

  it("con mucha agenda enseña solo lo cercano a la cita nueva", () => {
    const muchos = Array.from({ length: 10 }, (_, k) => ev({ id: `e${k}`, summary: `Cita ${k}`, start: { dateTime: `2026-10-28T${String(8 + k).padStart(2, "0")}:00:00+01:00` }, end: { dateTime: `2026-10-28T${String(8 + k).padStart(2, "0")}:30:00+01:00` } }));
    const i = at("2026-10-28", "13:00"), f = at("2026-10-28", "13:45");
    const h = evaluarHueco(i, f, muchos, ZONA_MADRID);
    const t = textoAgendaDelDia(h, i, f, ZONA_MADRID, "mié 28 oct");
    expect(t.filter((x) => x.startsWith("• …"))).toHaveLength(2);
    expect(t.length).toBeLessThan(11);
  });

  it("en Miami las horas son las de Miami", () => {
    const e = ev({ id: "m1", summary: "Trenzas Dani", start: { dateTime: "2026-10-22T11:00:00-04:00" }, end: { dateTime: "2026-10-22T13:00:00-04:00" } });
    const i = at("2026-10-22", "14:00", ZONA_MIAMI), f = at("2026-10-22", "16:00", ZONA_MIAMI);
    const h = evaluarHueco(i, f, [e], ZONA_MIAMI);
    const t = textoAgendaDelDia(h, i, f, ZONA_MIAMI, "jue 22 oct").join("\n");
    expect(t).toContain("11:00–13:00 Trenzas Dani");
    expect(t).toContain("14:00–16:00 ◀ esta cita");
    expect(describirEvento(e, ZONA_MIAMI)).toBe("«Trenzas Dani» 11:00–13:00");
  });
});
