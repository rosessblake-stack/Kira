import { describe, expect, it } from "vitest";
import { avisoDeEstancia, describirEstancia, diasEntre, dondeEstoy, fechaCorta, fechaValida, interpretarEstancias, sumarDias, unir, type Estancia } from "../lib/estancias";

const m = (desde: string, hasta: string): Estancia => ({ ubicacion: "miami", desde, hasta });

describe("fechas de calendario", () => {
  it("fechaValida: solo días que existen", () => {
    expect(fechaValida("2026-11-03")).toBe(true);
    for (const f of ["2026-02-30", "2026-13-01", "3/11/2026", "", null, 5, "2026-1-1"]) expect(fechaValida(f)).toBe(false);
  });
  it("días entre (ambos incluidos), sumar y formato", () => {
    expect(diasEntre("2026-11-03", "2026-11-03")).toBe(1);
    expect(diasEntre("2026-11-03", "2026-11-20")).toBe(18);
    expect(diasEntre("2026-12-30", "2027-01-02")).toBe(4);
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(fechaCorta("2026-11-03")).toBe("3 nov 2026");
    expect(describirEstancia(m("2026-11-03", "2026-11-20"))).toBe("del 3 nov 2026 al 20 nov 2026");
  });
});

describe("unir y leer estancias", () => {
  it("une las que se solapan o son de días seguidos y las ordena", () => {
    expect(unir([m("2026-11-11", "2026-11-20"), m("2026-11-03", "2026-11-10")])).toEqual([m("2026-11-03", "2026-11-20")]); // 10 y 11 son seguidos
    expect(unir([m("2026-11-03", "2026-11-12"), m("2026-11-08", "2026-11-20")])).toEqual([m("2026-11-03", "2026-11-20")]);
    expect(unir([m("2026-12-01", "2026-12-05"), m("2026-11-03", "2026-11-10")])).toEqual([m("2026-11-03", "2026-11-10"), m("2026-12-01", "2026-12-05")]);
    expect(unir([m("2026-11-03", "2026-11-30"), m("2026-11-10", "2026-11-12")])).toEqual([m("2026-11-03", "2026-11-30")]); // una dentro de otra
  });

  it("lo guardado se lee sin fiarse: lo roto se descarta", () => {
    const raw = [
      { ubicacion: "miami", desde: "2026-11-03", hasta: "2026-11-20" },
      { ubicacion: "espana", desde: "2026-11-03", hasta: "2026-11-20" }, // no es un viaje
      { ubicacion: "miami", desde: "2026-11-20", hasta: "2026-11-03" }, // al revés
      { ubicacion: "miami", desde: "2026-02-30", hasta: "2026-03-05" }, // no existe
      { ubicacion: "miami", desde: "2026-01-01", hasta: "2026-12-31" }, // más de 120 días
      null, "x", 5, {},
    ];
    expect(interpretarEstancias(raw)).toEqual([m("2026-11-03", "2026-11-20")]);
    for (const x of [null, undefined, "x", 5, {}]) expect(interpretarEstancias(x)).toEqual([]);
  });
});

describe("dónde está Blake: España salvo en sus viajes", () => {
  const e = [m("2026-11-03", "2026-11-20")];
  it("los extremos cuentan (ambos incluidos)", () => {
    expect(dondeEstoy("2026-11-02", e)).toBe("espana");
    expect(dondeEstoy("2026-11-03", e)).toBe("miami");
    expect(dondeEstoy("2026-11-20", e)).toBe("miami");
    expect(dondeEstoy("2026-11-21", e)).toBe("espana");
    expect(dondeEstoy("2026-11-10", [])).toBe("espana");
  });
});

describe("avisos de la propuesta según los viajes", () => {
  const e = [m("2026-11-03", "2026-11-20"), m("2027-01-05", "2027-01-12")];

  it("cita de España cuando estás en España, o de Miami cuando estás en Miami: sin aviso", () => {
    expect(avisoDeEstancia("espana", "2026-10-28", e)).toBeNull();
    expect(avisoDeEstancia("miami", "2026-11-10", e)).toBeNull();
  });

  it("cita de España mientras estás en Miami: avisa con las fechas del viaje", () => {
    expect(avisoDeEstancia("espana", "2026-11-10", e)).toBe("🚫 Ese día estás en Miami (del 3 nov 2026 al 20 nov 2026): no estás en España.");
  });

  it("cita de Miami fuera de tus viajes: avisa y enseña los próximos", () => {
    expect(avisoDeEstancia("miami", "2026-10-28", e)).toBe("🚫 Ese día no estás en Miami (tus estancias en Miami: del 3 nov 2026 al 20 nov 2026; del 5 ene 2027 al 12 ene 2027).");
    expect(avisoDeEstancia("miami", "2026-12-01", e)).toContain("del 5 ene 2027 al 12 ene 2027");
    expect(avisoDeEstancia("miami", "2026-12-01", e)).not.toContain("3 nov 2026");
  });

  it("cita de Miami sin ningún viaje apuntado: explica cómo apuntarlo", () => {
    expect(avisoDeEstancia("miami", "2026-10-28", [])).toContain("/viaje miami 3/11 al 20/11");
  });

  it("sin fecha o con una fecha rara no hay aviso", () => {
    expect(avisoDeEstancia("miami", null, e)).toBeNull();
    expect(avisoDeEstancia("miami", undefined, e)).toBeNull();
    expect(avisoDeEstancia("miami", "mañana", e)).toBeNull();
  });
});
