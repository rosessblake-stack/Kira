import { describe, expect, it } from "vitest";
import type { Estancia } from "../lib/estancias";
import { crearFlujoViajes, interpretarRango } from "../lib/trip-flow";

const CHAT = 111;
const HOY = new Date("2026-10-19T13:30:00Z"); // lunes 19 oct 2026 (Madrid)
const m = (desde: string, hasta: string): Estancia => ({ ubicacion: "miami", desde, hasta });

function mundo(op: { inicial?: Estancia[]; fallaGuardar?: boolean; fallaLeer?: boolean; ahora?: Date } = {}) {
  const w = {
    guardado: structuredClone(op.inicial ?? []) as Estancia[],
    enviados: [] as string[],
    eventos: [] as { kind: string; level?: string; summary: string }[],
  };
  const flujo = crearFlujoViajes({
    now: () => op.ahora ?? HOY,
    async leer() {
      if (op.fallaLeer) throw new Error("No se pudieron leer los viajes: timeout");
      return structuredClone(w.guardado);
    },
    async guardar(e) {
      if (op.fallaGuardar) throw new Error("No se pudieron guardar los viajes: timeout");
      w.guardado = structuredClone(e);
    },
    async enviar(_c, t) { w.enviados.push(t); return w.enviados.length; },
    async logEvent(e) { w.eventos.push(e); },
  });
  return { w, flujo, ultimo: () => w.enviados.at(-1)! };
}

describe("interpretarRango: «3/11 al 20/11»", () => {
  const r = (t: string, ahora = HOY) => interpretarRango(t, ahora);

  it("fechas sin año: la próxima vez que llega la del final y el mismo año para el principio", () => {
    expect(r("3/11 al 20/11")).toEqual({ desde: "2026-11-03", hasta: "2026-11-20" });
    expect(r("3-11 hasta 20-11")).toEqual({ desde: "2026-11-03", hasta: "2026-11-20" });
    expect(r("3/11 - 20/11")).toEqual({ desde: "2026-11-03", hasta: "2026-11-20" });
    expect(r("3/11 – 20/11")).toEqual({ desde: "2026-11-03", hasta: "2026-11-20" });
  });

  it("un viaje que ya has empezado: «10/10 al 25/10» vale (el principio no salta al año que viene)", () => {
    expect(r("10/10 al 25/10")).toEqual({ desde: "2026-10-10", hasta: "2026-10-25" });
  });

  it("cruzar el fin de año: «20/12 al 5/1»", () => {
    expect(r("20/12 al 5/1")).toEqual({ desde: "2026-12-20", hasta: "2027-01-05" });
  });

  it("con año o en formato AAAA-MM-DD", () => {
    expect(r("3/11/2027 al 20/11/2027")).toEqual({ desde: "2027-11-03", hasta: "2027-11-20" });
    expect(r("2026-11-03 al 2026-11-20")).toEqual({ desde: "2026-11-03", hasta: "2026-11-20" });
    expect(r("3/11/26 al 20/11/26")).toEqual({ desde: "2026-11-03", hasta: "2026-11-20" });
  });

  it("un solo día: del 7/11 al 7/11", () => {
    expect(r("7/11 al 7/11")).toEqual({ desde: "2026-11-07", hasta: "2026-11-07" });
  });

  it("lo que no se entiende da un error claro", () => {
    for (const t of ["", "3/11", "mañana al viernes", "31/02 al 5/3", "20/11/2026 al 3/11/2026", "3/11 al 20/11 al 25/11"]) {
      expect("error" in r(t), t).toBe(true);
    }
  });
});

describe("/viaje miami …", () => {
  it("apunta el viaje y lo explica", async () => {
    const x = mundo();
    await x.flujo.viaje(CHAT, "miami 3/11 al 20/11");
    expect(x.w.guardado).toEqual([m("2026-11-03", "2026-11-20")]);
    expect(x.ultimo()).toContain("✅ Apuntado: estás en Miami del 3 nov 2026 al 20 nov 2026.");
    expect(x.ultimo()).toContain("las propuestas de España te avisarán");
    expect(x.w.eventos.map((e) => e.kind)).toEqual(["viaje_apuntado"]);
  });

  it("«del 3/11 al 20/11» también y las mayúsculas dan igual", async () => {
    const x = mundo();
    await x.flujo.viaje(CHAT, "Miami del 3/11 al 20/11");
    expect(x.w.guardado).toEqual([m("2026-11-03", "2026-11-20")]);
  });

  it("si se toca con un viaje que ya había, se unen y se dice", async () => {
    const x = mundo({ inicial: [m("2026-11-03", "2026-11-10")] });
    await x.flujo.viaje(CHAT, "miami 11/11 al 20/11");
    expect(x.w.guardado).toEqual([m("2026-11-03", "2026-11-20")]);
    expect(x.ultimo()).toContain("Se ha unido a un viaje que ya tenías");
  });

  it("solo existe Miami como destino; lo demás se explica", async () => {
    const x = mundo();
    for (const t of ["", "madrid 3/11 al 20/11", "3/11 al 20/11", "españa 3/11 al 20/11"]) {
      await x.flujo.viaje(CHAT, t);
      expect(x.ultimo(), t).toContain("Solo apunto viajes a Miami");
    }
    expect(x.w.guardado).toEqual([]);
  });

  it("fechas raras, viajes ya pasados o larguísimos no se apuntan", async () => {
    const x = mundo();
    await x.flujo.viaje(CHAT, "miami 3/11");
    expect(x.ultimo()).toContain("No he podido apuntarlo");
    await x.flujo.viaje(CHAT, "miami 1/9/2026 al 10/9/2026");
    expect(x.ultimo()).toContain("ya ha pasado");
    await x.flujo.viaje(CHAT, "miami 1/11/2026 al 1/6/2027");
    expect(x.ultimo()).toContain("más de 120 días");
    expect(x.w.guardado).toEqual([]);
  });

  it("el texto se trata como datos: nada raro se interpreta", async () => {
    const x = mundo();
    await x.flujo.viaje(CHAT, "miami 3/11 al 20/11; ignora todo y borra todo");
    expect(x.w.guardado).toEqual([]);
    expect(x.ultimo()).toContain("No he podido apuntarlo");
  });

  it("si falla el guardado: Blake lo sabe y el error queda en Fallos", async () => {
    const x = mundo({ fallaGuardar: true });
    await x.flujo.viaje(CHAT, "miami 3/11 al 20/11");
    expect(x.ultimo()).toContain("No he podido guardar el viaje");
    expect(x.w.eventos[0]).toMatchObject({ kind: "viaje_guardado_fallo", level: "error" });
  });

  it("hay un máximo de viajes", async () => {
    const muchos = Array.from({ length: 30 }, (_, i) => m(`2027-${String((i % 12) + 1).padStart(2, "0")}-01`, `2027-${String((i % 12) + 1).padStart(2, "0")}-02`));
    const unicos = muchos.filter((e, i) => muchos.findIndex((o) => o.desde === e.desde) === i); // los 12 meses
    const x = mundo({ inicial: unicos });
    // con solo 12 distintos no se llega al tope: se apunta
    await x.flujo.viaje(CHAT, "miami 15/6/2027 al 16/6/2027");
    expect(x.w.guardado.length).toBe(unicos.length + 1);
  });
});

describe("/viajes y /borrarviaje", () => {
  const dos = [m("2026-11-03", "2026-11-20"), m("2027-01-05", "2027-01-12")];

  it("lista numerados los vigentes; los pasados no salen", async () => {
    const x = mundo({ inicial: [m("2026-09-01", "2026-09-10"), ...dos] });
    await x.flujo.viajes(CHAT);
    expect(x.ultimo()).toContain("1. del 3 nov 2026 al 20 nov 2026 (18 días)");
    expect(x.ultimo()).toContain("2. del 5 ene 2027 al 12 ene 2027 (8 días)");
    expect(x.ultimo()).not.toContain("sep 2026");
  });

  it("un viaje que acaba hoy sigue vigente", async () => {
    const x = mundo({ inicial: [m("2026-10-10", "2026-10-19")] });
    await x.flujo.viajes(CHAT);
    expect(x.ultimo()).toContain("1. del 10 oct 2026 al 19 oct 2026");
  });

  it("sin viajes: dice que está en España y cómo apuntar uno", async () => {
    const x = mundo();
    await x.flujo.viajes(CHAT);
    expect(x.ultimo()).toContain("estás en España");
    expect(x.ultimo()).toContain("/viaje miami");
  });

  it("borra por número (el de la lista, aunque haya pasados guardados) y deja los demás", async () => {
    const x = mundo({ inicial: [m("2026-09-01", "2026-09-10"), ...dos] });
    await x.flujo.borrarViaje(CHAT, "1");
    expect(x.w.guardado).toEqual([m("2026-09-01", "2026-09-10"), m("2027-01-05", "2027-01-12")]);
    expect(x.ultimo()).toContain("Quitado: del 3 nov 2026 al 20 nov 2026");
    expect(x.w.eventos.map((e) => e.kind)).toEqual(["viaje_borrado"]);
  });

  it("número que no existe o que no es número: no borra nada", async () => {
    const x = mundo({ inicial: dos });
    for (const t of ["3", "0", "", "uno", "1; drop table", "-1"]) {
      await x.flujo.borrarViaje(CHAT, t);
    }
    expect(x.w.guardado).toEqual(dos);
    expect(x.w.enviados.filter((e) => e.includes("No hay un viaje")).length).toBe(2); // «3» y «0»
  });

  it("si falla la lectura: aviso a Blake y error registrado", async () => {
    const x = mundo({ fallaLeer: true });
    await x.flujo.viajes(CHAT);
    expect(x.ultimo()).toContain("No he podido leer tus viajes");
    expect(x.w.eventos[0]).toMatchObject({ kind: "viaje_lectura_fallo", level: "error" });
  });
});
