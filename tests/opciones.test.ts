import { describe, expect, it } from "vitest";
import { evaluarHueco, type EventoAgenda } from "../lib/agenda-eventos";
import { REGLAS_ESPANA, ZONA_MADRID, aUtc } from "../lib/agenda";
import { calcularOpciones, interpretarElegida, motivoNoDisponible, textoOpciones } from "../lib/opciones";

const ev = (fecha: string, ini: string, fin: string): EventoAgenda => ({
  id: `${fecha}${ini}`, titulo: "Cita", inicio: aUtc(fecha, ini), fin: aUtc(fecha, fin), dias: null, libre: false, esDeKira: false, esPrueba: false, bookingId: null,
});
const AHORA = new Date("2026-10-19T08:00:00Z");

function calcular(eventos: EventoAgenda[], pedida = ["2026-10-22", "12:00", "15:00"]) {
  const inicio = aUtc(pedida[0], pedida[1]);
  const fin = aUtc(pedida[0], pedida[2]);
  const hueco = evaluarHueco(inicio, fin, eventos, ZONA_MADRID, { horario: REGLAS_ESPANA.horario });
  return { hueco, opciones: calcularOpciones({ inicio, fin, hueco, eventos, zona: ZONA_MADRID, reglas: REGLAS_ESPANA, ahora: AHORA }) };
}

describe("calcularOpciones", () => {
  it("huecos del mismo día + la misma hora el siguiente día libre", () => {
    const { hueco, opciones } = calcular([ev("2026-10-22", "12:00", "14:00")]);
    expect(hueco.choques).toHaveLength(1);
    expect(opciones.length).toBeGreaterThanOrEqual(2);
    expect(opciones.length).toBeLessThanOrEqual(4);
    const ultima = opciones.at(-1)!;
    expect(ultima.inicio).toBe(aUtc("2026-10-23", "12:00").toISOString()); // viernes, misma hora
  });

  it("la «misma hora» salta domingo y lunes (días libres de Blake)", () => {
    const { opciones } = calcular([ev("2026-10-24", "12:00", "14:00")], ["2026-10-24", "12:00", "15:00"]);
    const ultima = opciones.at(-1)!;
    expect(ultima.inicio).toBe(aUtc("2026-10-27", "12:00").toISOString()); // sábado → el martes
  });

  it("la «misma hora» no cae sobre otra cita ni sin margen", () => {
    const { opciones } = calcular([ev("2026-10-22", "12:00", "14:00"), ev("2026-10-23", "12:00", "13:00")]);
    expect(opciones.some((o) => o.inicio === aUtc("2026-10-23", "12:00").toISOString())).toBe(false);
  });

  it("no ofrece huecos del pasado", () => {
    const hoy = new Date("2026-10-22T09:00:00Z"); // 11:00 en Madrid
    const inicio = aUtc("2026-10-22", "12:00");
    const fin = aUtc("2026-10-22", "15:00");
    const eventos = [ev("2026-10-22", "12:00", "14:00")];
    const hueco = evaluarHueco(inicio, fin, eventos, ZONA_MADRID, { horario: REGLAS_ESPANA.horario });
    const o = calcularOpciones({ inicio, fin, hueco, eventos, zona: ZONA_MADRID, reglas: REGLAS_ESPANA, ahora: new Date("2026-10-22T11:30:00Z") });
    expect(o.every((x) => Date.parse(x.inicio) > Date.parse("2026-10-22T11:30:00Z"))).toBe(true);
    expect(hoy).toBeDefined();
  });
});

describe("interpretarElegida", () => {
  it("números sueltos y formas habituales", () => {
    for (const [t, n] of [["1", 1], ["2.", 2], ["Opción 3", 3], ["la 2", 2], ["el 1", 1], ["opcion2", 2], ["2️⃣", 2], ["  3  ", 3], ["primera", 1], ["La segunda", 2], ["segunda opción", 2], ["Tercera!", 3], ["cuarto", 4], ["dos", 2], ["quiero la primera", 1], ["vale, la segunda", 2], ["me quedo con la tercera", 3], ["la primera por favor", 1]] as const) {
      expect(interpretarElegida(t, 4)).toBe(n);
    }
  });
  it("lo demás no se interpreta", () => {
    for (const t of ["5", "0", "vale", "la quinta", "¿la segunda?", "¿la 2?", "1 y 2", "la 2 pero más tarde", "la primera o la segunda", "no me va ninguna", "12", "", "opción"]) {
      expect(interpretarElegida(t, 4)).toBeNull();
    }
    expect(interpretarElegida("4", 3)).toBeNull();
  });
});

describe("textoOpciones", () => {
  it("lista las opciones con su palabra (Primera, Segunda…) y pide esa palabra", () => {
    const t = textoOpciones("Marta", aUtc("2026-10-22", "12:00"), [
      { inicio: aUtc("2026-10-22", "15:00").toISOString(), fin: aUtc("2026-10-22", "18:00").toISOString() },
      { inicio: aUtc("2026-10-23", "12:00").toISOString(), fin: aUtc("2026-10-23", "15:00").toISOString() },
    ], ZONA_MADRID);
    expect(t).toContain("¡Hola, Marta!");
    expect(t).toContain("Primera: jueves 22 de octubre de 15:00 a 18:00");
    expect(t).toContain("Segunda: viernes 23 de octubre de 12:00 a 15:00");
    expect(t).toContain("«quiero la primera» o «quiero la segunda»");
  });
});

describe("domingo y lunes (día libre)", () => {
  it("motivoNoDisponible lo detecta y se ofrecen 3 días distintos a la misma hora, sin domingo ni lunes", () => {
    const inicio = aUtc("2026-10-25", "12:00"); // domingo
    const fin = aUtc("2026-10-25", "15:00");
    const hueco = evaluarHueco(inicio, fin, [], ZONA_MADRID, { horario: REGLAS_ESPANA.horario });
    expect(motivoNoDisponible(inicio, fin, hueco, ZONA_MADRID, REGLAS_ESPANA)).toBe("dia_libre");
    const op = calcularOpciones({ inicio, fin, hueco: { ...hueco, alternativas: [] }, eventos: [], zona: ZONA_MADRID, reglas: REGLAS_ESPANA, ahora: AHORA, maxDiasSiguientes: 3 });
    expect(op.map((o) => o.inicio.slice(0, 10))).toEqual(["2026-10-27", "2026-10-28", "2026-10-29"]);
    const t = textoOpciones("Ana", inicio, op, ZONA_MADRID, { motivo: "dia_libre" });
    expect(t).toContain("los domingos y lunes descanso");
  });
  it("un martes libre no tiene motivo", () => {
    const inicio = aUtc("2026-10-27", "12:00");
    const fin = aUtc("2026-10-27", "15:00");
    const hueco = evaluarHueco(inicio, fin, [], ZONA_MADRID, { horario: REGLAS_ESPANA.horario });
    expect(motivoNoDisponible(inicio, fin, hueco, ZONA_MADRID, REGLAS_ESPANA)).toBeNull();
  });
});
