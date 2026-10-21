import { describe, expect, it } from "vitest";
import { clasificacionDesdeFormulario } from "../lib/formulario";

describe("estilo y número de trenzas del formulario", () => {
  const ahora = new Date("2026-10-21T10:00:00Z");
  const base = { contactoId: "1", instagram: null, nombre: "Marta", email: null, ubicacion: "espana" as const, ubicacionDudosa: false, fotoReferenciaUrl: null, fotoPeloUrl: null, usoExtensiones: null, colorExtensiones: null, largo: null, fechaTexto: null, texto: "x" };
  it("estilo elegido = pegadas con ese estilo, sin aviso de tipo asumido", () => {
    const c = clasificacionDesdeFormulario({ ...base, estilo: "twist", numeroTrenzas: 5 }, ahora, "Europe/Madrid")!;
    expect(c).toMatchObject({ tipo_trenzado: "pegadas", estilo_pegadas: "twist", numero_trenzas: 5 });
    expect(c.avisosValidacion.join(" ")).not.toContain("Tipo asumido");
  });
  it("solo el número = pegadas con aviso (regla de Blake)", () => {
    const c = clasificacionDesdeFormulario({ ...base, numeroTrenzas: 6 }, ahora, "Europe/Madrid")!;
    expect(c).toMatchObject({ tipo_trenzado: "pegadas", estilo_pegadas: null, numero_trenzas: 6 });
    expect(c.avisosValidacion.join(" ")).toContain("Tipo asumido");
  });
  it("sin ninguno de los dos queda como antes", () => {
    const c = clasificacionDesdeFormulario(base, ahora, "Europe/Madrid")!;
    expect(c).toMatchObject({ tipo_trenzado: null, estilo_pegadas: null, numero_trenzas: null });
  });
});
