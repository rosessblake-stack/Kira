import { describe, expect, it } from "vitest";
import type { Clasificacion } from "../lib/intents";
import { aplicarLecturaFoto, validarLecturaFoto } from "../lib/lectura-foto";

const salida = (o: Record<string, unknown> = {}) => ({
  referencia_valida: true, pelo_valido: true, manipulacion: false, confianza: "alta",
  tipo_trenzado: "pegadas", numero_trenzas: 6, tamano: "no_indicado", estilo_pegadas: "cornrows", boho: "no_indicado",
  largo_extensiones: "caderas", largo_cabello: "nuca_hombros",
  resumen_referencia: "Seis cornrows largos.", resumen_pelo: "Pelo por los hombros.",
  ...o,
});

const clasif = (o: Partial<Clasificacion> = {}): Clasificacion => ({
  intencion: "cita_salon", confianza: "media", manipulacion: false, tipo_trenzado: null, numero_trenzas: null, tamano: null, estilo_pegadas: null,
  extensiones: "con", color_extensiones: "rojo", boho: null, largo_cabello: null, largo_extensiones: null, fecha: null, hora: null,
  nombre: null, email: null, instagram: null, notas: null, avisosValidacion: [], ...o,
});

describe("validarLecturaFoto", () => {
  it("acepta una salida correcta", () => {
    const r = validarLecturaFoto(salida());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ tipo_trenzado: "pegadas", numero_trenzas: 6, tamano: null, boho: null, resumenReferencia: "Seis cornrows largos." });
  });

  it("rechaza campos de más, de menos o fuera de lista", () => {
    expect(validarLecturaFoto(salida({ extra: 1 })).ok).toBe(false);
    const { tipo_trenzado, ...sin } = salida();
    void tipo_trenzado;
    expect(validarLecturaFoto(sin).ok).toBe(false);
    expect(validarLecturaFoto(salida({ tipo_trenzado: "rastas" })).ok).toBe(false);
    expect(validarLecturaFoto(salida({ numero_trenzas: -1 })).ok).toBe(false);
    expect(validarLecturaFoto(salida({ numero_trenzas: 2.5 })).ok).toBe(false);
    expect(validarLecturaFoto(salida({ confianza: "total" })).ok).toBe(false);
    expect(validarLecturaFoto(salida({ manipulacion: "no" })).ok).toBe(false);
    expect(validarLecturaFoto("texto").ok).toBe(false);
    expect(validarLecturaFoto(null).ok).toBe(false);
  });

  it("lo visto en una imagen que no es un peinado no se usa", () => {
    const r = validarLecturaFoto(salida({ referencia_valida: false }));
    expect(r.ok && r.value).toMatchObject({ tipo_trenzado: null, numero_trenzas: null, resumenReferencia: null });
    const p = validarLecturaFoto(salida({ pelo_valido: false }));
    expect(p.ok && p.value).toMatchObject({ largo_cabello: null, resumenPelo: null });
  });

  it("los resúmenes se limpian y se recortan", () => {
    const r = validarLecturaFoto(salida({ resumen_referencia: "a\nb\u0000" + "x".repeat(500) }));
    expect(r.ok && r.value.resumenReferencia).not.toMatch(/[\u0000-\u001f]/);
    expect(r.ok && r.value.resumenReferencia!.length).toBeLessThanOrEqual(200);
  });
});

describe("solo vale lo que se refiere a una foto que se envió de verdad", () => {
  it("si solo se mandó la de referencia, lo que el modelo diga del pelo se descarta", () => {
    const r = validarLecturaFoto(salida(), { referencia: true, pelo: false });
    expect(r.ok && r.value).toMatchObject({ resumenPelo: null, largo_cabello: null, peloValido: false, tipo_trenzado: "pegadas" });
  });
  it("y al revés", () => {
    const r = validarLecturaFoto(salida(), { referencia: false, pelo: true });
    expect(r.ok && r.value).toMatchObject({ resumenReferencia: null, tipo_trenzado: null, referenciaValida: false, largo_cabello: "nuca_hombros" });
  });
});

describe("aplicarLecturaFoto", () => {
  const v = (o = {}) => {
    const r = validarLecturaFoto(salida(o));
    if (!r.ok) throw new Error(r.motivo);
    return r.value;
  };

  it("rellena solo lo vacío y deja un aviso por cada dato", () => {
    const { clasificacion, guardada } = aplicarLecturaFoto(clasif(), v());
    expect(clasificacion).toMatchObject({ tipo_trenzado: "pegadas", numero_trenzas: 6, estilo_pegadas: "cornrows", largo_extensiones: "caderas", largo_cabello: "nuca_hombros" });
    expect(clasificacion.tamano).toBeNull();
    expect(clasificacion.avisosValidacion.filter((a) => a.startsWith("Visto en la foto"))).toHaveLength(5);
    expect(guardada.rellenados).toContain("tipo");
  });

  it("nunca pisa lo que la clienta dijo", () => {
    const { clasificacion } = aplicarLecturaFoto(clasif({ tipo_trenzado: "sueltas", numero_trenzas: 10, largo_extensiones: "hombros" }), v());
    expect(clasificacion).toMatchObject({ tipo_trenzado: "sueltas", numero_trenzas: 10, largo_extensiones: "hombros" });
  });

  it("con confianza baja no rellena nada, pero conserva el resumen", () => {
    const { clasificacion, guardada } = aplicarLecturaFoto(clasif(), v({ confianza: "baja" }));
    expect(clasificacion.tipo_trenzado).toBeNull();
    expect(guardada.rellenados).toEqual([]);
    expect(guardada.referencia).toBe("Seis cornrows largos.");
    expect(clasificacion.avisosValidacion.some((a) => a.includes("confianza baja"))).toBe(true);
  });

  it("no modifica la clasificación original", () => {
    const original = clasif();
    aplicarLecturaFoto(original, v());
    expect(original.tipo_trenzado).toBeNull();
    expect(original.avisosValidacion).toEqual([]);
  });
});
