import { describe, expect, it } from "vitest";
import { agruparDatos, etiquetaServicio, lineaRegistro, parsearReal, registroDesdeReserva, textoDatos, type RegistroGuardado } from "../lib/registro";
import type { Reserva } from "../lib/proposal-flow";
import { specDesdeClasificacion, type SpecGuardada } from "../lib/proposal";
import type { Clasificacion } from "../lib/intents";

const clas = (o: Partial<Clasificacion> = {}): Clasificacion => ({
  intencion: "cita_salon", confianza: "alta", manipulacion: false,
  tipo_trenzado: "pegadas", numero_trenzas: 6, tamano: null, estilo_pegadas: null, extensiones: "con", color_extensiones: "rojo",
  boho: null, largo_cabello: "nuca_hombros", largo_extensiones: "caderas", fecha: "2026-10-20", hora: "12:00",
  nombre: "Ana López", email: "ana@correo.com", instagram: "ana_t", notas: null, avisosValidacion: [], ...o,
});

function reserva(spec: SpecGuardada, o: Partial<Reserva> = {}): Reserva {
  return {
    id: "res-1", conversation_id: "conv-1", client_name: "Ana López", client_email: "ana@correo.com", service_description: "x",
    price_cents: 8000, deposit_cents: 2000, duration_minutes: 180, starts_at: "2026-10-20T10:00:00.000Z", ends_at: "2026-10-20T13:00:00.000Z",
    status: "aprobada", spec, pricing: { origen: "legacy", moneda: "EUR", horas: 3, materiales: 5, legacy: { totalCentimos: 7565, manoObra: 70.65, materiales: 5, tarifaHora: 23.55, valorConocimiento: 42.53, costeTiempo: 28.13 } },
    warnings: [], reply_draft: null, proposal_nonce: null, telegram_message_id: null, edit_requested_at: null, is_test: false,
    approved_by_telegram_user: 1, approved_at: "2026-10-13T13:30:00.000Z", ...o,
  };
}

describe("registroDesdeReserva: la foto fija de la cita al aprobarla", () => {
  it("guarda lo que Kira sugería y lo que Blake dejó, sin ningún texto de la clienta", () => {
    const spec = { ...specDesdeClasificacion(clas(), "Hola, soy Ana y mi correo es ana@correo.com", "claude"), precio_manual_centimos: 8000 };
    const r = registroDesdeReserva(reserva(spec));
    expect(r).toMatchObject({
      booking_id: "res-1", is_test: false, ubicacion: "espana", moneda: "EUR", client_name: "Ana",
      tipo_trenzado: "pegadas", numero_trenzas: 6, extensiones: "con", largo_cabello: "nuca_hombros",
      horas_sugeridas: 3, materiales_sugeridos: 5, precio_legacy_cents: 7565,
      horas_aprobadas: 3, materiales_aprobados: 5, precio_aprobado_cents: 8000, precio_origen: "manual",
    });
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/correo|Hola|ana_t|López/);
  });

  it("lo que Blake cambió (horas, materiales) se guarda como aprobado y lo sugerido sigue siendo lo de Kira", () => {
    const spec = { ...specDesdeClasificacion(clas(), "x"), horas: 3.5, materiales: 9 };
    const r = registroDesdeReserva(reserva(spec));
    expect(r).toMatchObject({ horas_sugeridas: 3, materiales_sugeridos: 5, horas_aprobadas: 3.5, materiales_aprobados: 9, precio_origen: "legacy" });
  });

  it("una cita de Miami guarda dólares y la ubicación; sin tipo no inventa horas ni materiales", () => {
    const spec = specDesdeClasificacion(clas({ tipo_trenzado: null, extensiones: null }), "x", "claude", "miami");
    const r = registroDesdeReserva(reserva(spec, { pricing: { origen: "manual", moneda: "USD" }, is_test: true }));
    expect(r).toMatchObject({ ubicacion: "miami", moneda: "USD", is_test: true, horas_sugeridas: null, materiales_sugeridos: null, materiales_aprobados: null, precio_legacy_cents: null });
  });

  it("sin nombre, el cliente queda sin nombre", () => {
    const spec = specDesdeClasificacion(clas({ nombre: null }), "x");
    expect(registroDesdeReserva(reserva(spec)).client_name).toBeNull();
  });
});

describe("parsearReal: «horas 3,5; materiales 9; precio 80»", () => {
  it("entiende comas decimales, símbolos y varias líneas", () => {
    expect(parsearReal("horas 3,5; materiales 9 €; precio 80€")).toEqual({ datos: { horas: 3.5, materiales: 9, precioCents: 8000 }, errores: [] });
    expect(parsearReal("horas: 2h\nmateriales 7,25\ncobrado 60")).toEqual({ datos: { horas: 2, materiales: 7.25, precioCents: 6000 }, errores: [] });
  });

  it("las horas se redondean al cuarto de hora", () => {
    expect(parsearReal("horas 2,6").datos.horas).toBe(2.5);
    expect(parsearReal("horas 2,9").datos.horas).toBe(3);
  });

  it("la nota se limpia y se recorta", () => {
    expect(parsearReal("nota fue\u0000 muy   rápido").datos.nota).toBe("fue muy rápido");
    expect(parsearReal(`nota ${"a".repeat(700)}`).datos.nota).toHaveLength(500);
  });

  it("rechaza lo que no cuadra y lo dice", () => {
    const r = parsearReal("horas 0\nhoras 30\nmateriales gratis\nprecio 99999\nbaila 3");
    expect(r.datos).toEqual({});
    expect(r.errores).toHaveLength(5);
    expect(r.errores.join("\n")).toContain("no sé qué anotar");
  });

  it("lo bueno se anota aunque otra línea falle", () => {
    const r = parsearReal("horas 3\nprecio mucho");
    expect(r.datos).toEqual({ horas: 3 });
    expect(r.errores).toHaveLength(1);
  });
});

const guardado = (o: Partial<RegistroGuardado> = {}): RegistroGuardado => ({
  id: "id-1", seq: 12, created_at: "2026-10-13T13:30:00Z", booking_id: "res-1", is_test: false, ubicacion: "espana", moneda: "EUR", client_name: "Ana",
  starts_at: "2026-10-20T10:00:00.000Z", tipo_trenzado: "pegadas", numero_trenzas: 6, tamano: null, estilo: null, extensiones: "con", boho: null,
  largo_cabello: null, largo_extensiones: null, horas_sugeridas: 3, materiales_sugeridos: 5, precio_legacy_cents: 7565,
  horas_aprobadas: 3, materiales_aprobados: 5, precio_aprobado_cents: 8000, precio_origen: "legacy", perfil: {},
  horas_reales: null, materiales_reales: null, precio_real_cents: null, nota_real: null, real_at: null, ...o,
});
const conReal = (o: Partial<RegistroGuardado> = {}) => guardado({ real_at: "2026-10-21T10:00:00Z", horas_reales: 3.5, materiales_reales: 9, precio_real_cents: 8000, ...o });

describe("lineaRegistro y etiquetas", () => {
  it("enseña el número, lo aprobado y lo real (o «sin anotar»)", () => {
    const sin = lineaRegistro(guardado());
    expect(sin).toContain("#12 Ana · mar 20 oct, 12:00 · 6 trenzas pegadas · con extensiones");
    expect(sin).toContain("aprobado: 3 h · 5 € · 80 €");
    expect(sin).toContain("real: sin anotar");
    const con = lineaRegistro(conReal({ is_test: true }));
    expect(con).toContain("#12 🧪 Ana");
    expect(con).toContain("real: 3,5 h · materiales 9 € · cobrado 80 €");
  });

  it("las citas de Miami van en dólares y en hora de Miami", () => {
    const t = lineaRegistro(guardado({ ubicacion: "miami", moneda: "USD", precio_aprobado_cents: 15000 }));
    expect(t).toContain("mar 20 oct, 06:00");
    expect(t).toContain("150 $");
  });

  it("etiquetaServicio para sueltas y servicio sin concretar", () => {
    expect(etiquetaServicio({ tipo_trenzado: "sueltas", numero_trenzas: null, tamano: "large", extensiones: "con" })).toBe("sueltas large · con extensiones");
    expect(etiquetaServicio({ tipo_trenzado: null, numero_trenzas: null, tamano: null, extensiones: null })).toBe("servicio sin concretar");
  });
});

describe("agruparDatos y textoDatos", () => {
  it("agrupa por tipo, nº de trenzas y extensiones, y compara con lo que Kira sugiere", () => {
    const g = agruparDatos([
      conReal({ seq: 1, horas_reales: 3.5 }),
      conReal({ seq: 2, horas_reales: 4, materiales_reales: 11, precio_real_cents: 9000 }),
      conReal({ seq: 3, extensiones: "sin", horas_reales: 2 }),
      guardado({ seq: 4 }), // sin datos reales: no cuenta
    ]);
    expect(g).toHaveLength(2);
    const con = g.find((x) => x.titulo.includes("con extensiones"))!;
    expect(con.n).toBe(2);
    expect(con.horas).toEqual({ media: 3.75, min: 3.5, max: 4 });
    expect(con.materiales).toBe(10);
    expect(con.precioCents).toBe(8500);
    expect(con.sugeridas).toBe(3);
    const t = textoDatos(g, 1);
    expect(t).toContain("6 trenzas pegadas · con extensiones — 2 servicios: 3,75 h de media (de 3,5 a 4) · materiales 10 € · cobras 85 €");
    expect(t).toContain("Kira sugiere 3 h: se desvía 0,75 h.");
    expect(t).toContain("(No cuento 1 de prueba.)");
  });

  it("sin nada anotado explica cómo empezar", () => {
    expect(textoDatos([], 2)).toContain("/real");
    expect(textoDatos([], 2)).toContain("Hay 2 de prueba");
  });

  it("no mezcla euros con dólares", () => {
    const g = agruparDatos([conReal(), conReal({ moneda: "USD", ubicacion: "miami" })]);
    expect(g).toHaveLength(2);
  });
});
