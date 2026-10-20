import { describe, expect, it } from "vitest";
import type { Clasificacion } from "../lib/intents";
import { descripcionDeEvento, eventoDeReserva, lineaExtensiones, lineaServicio, precioCorto, tituloDeEvento } from "../lib/evento";
import { specDesdeClasificacion, type SpecGuardada } from "../lib/proposal";
import type { Reserva } from "../lib/proposal-flow";

const clas = (o: Partial<Clasificacion> = {}): Clasificacion => ({
  intencion: "cita_salon", confianza: "alta", manipulacion: false,
  tipo_trenzado: "pegadas", numero_trenzas: 6, tamano: null, estilo_pegadas: null, extensiones: "con", color_extensiones: "Negro 1B",
  boho: null, largo_cabello: "corto", largo_extensiones: "nuca", fecha: "2026-10-22", hora: "17:00",
  nombre: "Michael", email: "michal@gmail.com", instagram: null, notas: null, avisosValidacion: [], ...o,
});
const spec = (o: Partial<Clasificacion> = {}, cambios: Partial<SpecGuardada> = {}): SpecGuardada => ({ ...specDesdeClasificacion(clas(o), "x"), ...cambios });

describe("el evento con las convenciones reales de Blake", () => {
  it("descripción como en su agenda: servicio, extensiones (color), línea en blanco y precio", () => {
    expect(descripcionDeEvento(spec(), 6000, "EUR")).toBe("6 Trenzas\nCon extensiones (Negro 1B)\n\n60€");
    expect(descripcionDeEvento(spec({ extensiones: "sin", color_extensiones: null }), 5000, "EUR")).toBe("6 Trenzas\nSin extensiones\n\n50€");
  });

  it("con Instagram, en la última línea y con @", () => {
    expect(descripcionDeEvento(spec({ instagram: "yeraymc_" }), 6000, "EUR")).toBe("6 Trenzas\nCon extensiones (Negro 1B)\n\n60€\n@yeraymc_");
    expect(descripcionDeEvento(spec({ instagram: "@ya_con_arroba" }), 6000, "EUR")).toContain("\n@ya_con_arroba");
  });

  it("los céntimos van con coma y sin separador de miles; en Miami, con $", () => {
    expect(precioCorto(6015, "EUR")).toBe("60,15€");
    expect(precioCorto(14000, "EUR")).toBe("140€");
    expect(precioCorto(120000, "EUR")).toBe("1200€");
    expect(precioCorto(15000, "USD")).toBe("150$");
  });

  it("la línea de servicio imita sus citas: «6 Trenzas», «4 Flat Twist», «Large braids», «Fulani Medium»", () => {
    expect(lineaServicio(spec())).toBe("6 Trenzas");
    expect(lineaServicio(spec({ numero_trenzas: 4, estilo_pegadas: "twist" }))).toBe("4 Flat Twist");
    expect(lineaServicio(spec({ estilo_pegadas: "barrel_twist" }))).toBe("6 Barrel Twist");
    expect(lineaServicio(spec({ tipo_trenzado: "sueltas", tamano: "large", numero_trenzas: null }))).toBe("Large braids");
    expect(lineaServicio(spec({ tipo_trenzado: "sueltas", tamano: "xs_small" }))).toBe("XS Small braids");
    expect(lineaServicio(spec({ tipo_trenzado: "fulani", tamano: "medium" }))).toBe("Fulani Medium");
    expect(lineaServicio(spec({ tipo_trenzado: null }))).toBe("Trenzas");
    expect(lineaServicio(spec({ numero_trenzas: null }))).toBe("Trenzas pegadas");
    expect(lineaServicio(spec({ boho: true }))).toBe("6 Trenzas boho");
  });

  it("extensiones: con (y color), feed-in, sin, o nada si no se sabe", () => {
    expect(lineaExtensiones(spec())).toBe("Con extensiones (Negro 1B)");
    expect(lineaExtensiones(spec({ extensiones: "feedin", color_extensiones: null }))).toBe("Con extensiones");
    expect(lineaExtensiones(spec({ extensiones: "sin" }))).toBe("Sin extensiones");
    expect(lineaExtensiones(spec({ extensiones: null }))).toBeNull();
    expect(descripcionDeEvento(spec({ extensiones: null }), null, "EUR")).toBe("6 Trenzas");
  });

  it("título «Trenzas Nombre»; una prueba lo dice; sin nombre no se inventa", () => {
    expect(tituloDeEvento(spec(), "Michael", false)).toBe("Trenzas Michael");
    expect(tituloDeEvento(spec(), "Michael", true)).toBe("🧪 PRUEBA · Trenzas Michael");
    expect(tituloDeEvento(spec({ nombre: null }), "", false)).toBe("Trenzas (sin nombre)");
    expect(tituloDeEvento(spec(), "Mi\u0000chael\n  Ángel", false)).toBe("Trenzas Mi chael Ángel");
  });
});

describe("eventoDeReserva", () => {
  const reserva = (o: Partial<Reserva> = {}, s: SpecGuardada = spec()): Reserva => ({
    id: "61dba233-632a-4ee4-b9b2-1a72a18895d2", conversation_id: null, client_name: "Michael", client_email: "michal@gmail.com", service_description: "x",
    price_cents: 6000, deposit_cents: 2000, duration_minutes: 150, starts_at: "2026-10-22T15:00:00.000Z", ends_at: "2026-10-22T17:30:00.000Z",
    status: "pendiente_pago", spec: s, pricing: { origen: "manual" }, warnings: [], reply_draft: null, proposal_nonce: null, telegram_message_id: null,
    edit_requested_at: null, is_test: false, approved_by_telegram_user: 1, approved_at: null, ...o,
  });

  it("junta título, descripción, dirección (la de siempre en España), hora real y zona", () => {
    const e = eventoDeReserva(reserva());
    expect(e).toMatchObject({
      id: "kira61dba233632a4ee4b9b21a72a18895d2", bookingId: "61dba233-632a-4ee4-b9b2-1a72a18895d2", titulo: "Trenzas Michael",
      descripcion: "6 Trenzas\nCon extensiones (Negro 1B)\n\n60€", ubicacion: "Carrer de la Duquessa de la Victòria, 16", zona: "Europe/Madrid", prueba: false,
    });
    expect(e.inicio.toISOString()).toBe("2026-10-22T15:00:00.000Z");
    expect(e.fin.toISOString()).toBe("2026-10-22T17:30:00.000Z");
  });

  it("una cita de Miami: zona de Miami, dólares y la dirección que puso Blake", () => {
    const s = { ...specDesdeClasificacion(clas(), "x", "claude", "miami"), direccion: "1234 Collins Ave, Miami Beach" };
    const e = eventoDeReserva(reserva({}, s));
    expect(e).toMatchObject({ zona: "America/New_York", ubicacion: "1234 Collins Ave, Miami Beach" });
    expect(e.descripcion.endsWith("60$")).toBe(true);
  });

  it("Miami sin dirección: el evento va sin ubicación (no se inventa)", () => {
    expect(eventoDeReserva(reserva({}, specDesdeClasificacion(clas(), "x", "claude", "miami"))).ubicacion).toBeNull();
  });

  it("sin horario no se crea nada", () => {
    expect(() => eventoDeReserva(reserva({ starts_at: null }))).toThrow(/no tiene horario/);
    expect(() => eventoDeReserva(reserva({ ends_at: null }))).toThrow(/no tiene horario/);
  });
});
