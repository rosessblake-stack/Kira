import { describe, expect, it } from "vitest";
import { ManychatError, type ClienteManychat } from "../lib/manychat";
import { crearEnvioInstagram, crearFlujoResponder } from "../lib/responder";

function envio(o: { activo?: boolean; hayCliente?: boolean; falla?: Error } = {}) {
  const enviados: { id: string; texto: string }[] = [];
  const etiquetas: string[] = [];
  const cli = {
    async enviarTexto(id: string, texto: string) { if (o.falla) throw o.falla; enviados.push({ id, texto }); },
    async ponerEtiqueta(id: string, etiqueta: string) { etiquetas.push(`${id}:${etiqueta}`); },
  } as unknown as ClienteManychat;
  const f = crearEnvioInstagram({ activo: async () => o.activo ?? true, cliente: () => (o.hayCliente === false ? null : cli) });
  return { f, enviados, etiquetas };
}

describe("envío por Instagram", () => {
  it("encendido: manda el texto al contacto", async () => {
    const m = envio();
    expect(await m.f("777", "hola")).toEqual({ ok: true });
    expect(m.enviados).toEqual([{ id: "777", texto: "hola" }]);
    expect(m.etiquetas).toEqual(["777:esperando_kira"]); // para que su respuesta llegue a Kira
  });
  it("apagado (modo sombra): no manda nada y devuelve «canal_no_conectado»", async () => {
    const m = envio({ activo: false });
    expect(await m.f("777", "hola")).toEqual({ ok: false, motivo: "canal_no_conectado" });
    expect(m.enviados).toEqual([]);
  });
  it("sin clave de ManyChat: tampoco manda", async () => {
    const m = envio({ hayCliente: false });
    expect(await m.f("777", "hola")).toEqual({ ok: false, motivo: "canal_no_conectado" });
  });
  it("si ManyChat falla, devuelve el motivo (no lanza)", async () => {
    const m = envio({ falla: new ManychatError("ManyChat respondió 400 (Outside of the allowed window)", 400) });
    const r = await m.f("777", "hola");
    expect(r).toEqual({ ok: false, motivo: "ManyChat respondió 400 (Outside of the allowed window)" });
  });
  it("un error raro no filtra su texto", async () => {
    const m = envio({ falla: new Error("token=SECRETO") });
    const r = await m.f("777", "hola");
    expect(JSON.stringify(r)).not.toContain("SECRETO");
  });
});

function ajuste(o: { inicial?: boolean; hayClave?: boolean; fallaGuardar?: boolean } = {}) {
  let valor = o.inicial ?? false;
  const textos: string[] = [];
  const eventos: string[] = [];
  const p = crearFlujoResponder({
    leer: async () => valor,
    guardar: async (a) => { if (o.fallaGuardar) throw new Error("db"); valor = a; },
    hayClave: () => o.hayClave ?? true,
    enviar: async (_c, t) => { textos.push(t); },
    logEvent: async (e) => { eventos.push(e.kind); },
  });
  return { p, textos, eventos, valor: () => valor };
}

describe("/responder", () => {
  it("sin argumento dice cómo está: por defecto, modo sombra", async () => {
    const m = ajuste();
    await m.p.manejar(1, "");
    expect(m.textos[0]).toContain("MODO SOMBRA");
    expect(m.valor()).toBe(false);
  });
  it("on lo activa y lo deja anotado; off vuelve a sombra", async () => {
    const m = ajuste();
    await m.p.manejar(1, "on");
    expect(m.valor()).toBe(true);
    expect(m.textos.at(-1)).toContain("ACTIVADO");
    await m.p.manejar(1, " OFF ");
    expect(m.valor()).toBe(false);
    expect(m.eventos).toEqual(["responder_activado", "responder_desactivado"]);
  });
  it("no se activa sin la clave de ManyChat", async () => {
    const m = ajuste({ hayClave: false });
    await m.p.manejar(1, "on");
    expect(m.valor()).toBe(false);
    expect(m.textos[0]).toContain("MANYCHAT_API_KEY");
  });
  it("un argumento raro no cambia nada", async () => {
    const m = ajuste();
    await m.p.manejar(1, "quizás");
    expect(m.valor()).toBe(false);
    expect(m.eventos).toEqual([]);
  });
  it("si no se puede guardar, lo dice y sigue como estaba", async () => {
    const m = ajuste({ fallaGuardar: true });
    await m.p.manejar(1, "on");
    expect(m.textos[0]).toContain("Sigue como estaba");
    expect(m.eventos).toEqual(["responder_fallo"]);
  });
});
