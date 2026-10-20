import { describe, expect, it } from "vitest";
import type { ResultadoDescarga } from "../lib/descarga-segura";
import { crearEntradaManychat } from "../lib/manychat-entrada-flow";
import type { SolicitudManychat } from "../lib/manychat-entrada";

const S: SolicitudManychat = {
  contactoId: "mc-1", instagram: "clienta", nombre: "Michael", email: null, ubicacion: "espana", ubicacionDudosa: false,
  fotoReferenciaUrl: "https://scontent.cdninstagram.com/ref.jpg", fotoPeloUrl: "https://scontent.cdninstagram.com/pelo.jpg",
  usoExtensiones: null, colorExtensiones: null, largo: null, fechaTexto: null, texto: "x",
};

function montar(o: { descargas?: Record<string, ResultadoDescarga>; falla?: boolean; fallaEnviar?: boolean } = {}) {
  const guardadas: { conv: string; tipo: string; bytes: number }[] = [];
  const eventos: { kind: string; summary: string; level?: string; detail?: Record<string, unknown> }[] = [];
  const enviados: string[] = [];
  const descargadas: string[] = [];
  const e = crearEntradaManychat({
    proposals: {
      async recibirSolicitud(_chat, _s, alCrear) {
        if (alCrear) await alCrear("conv-1");
        if (o.falla) throw new Error("boom");
        return "conv-1";
      },
    },
    photos: { async guardarDeClienta(conv, tipo, bytes) { guardadas.push({ conv, tipo, bytes: bytes.length }); return { ok: true as const, repetida: false }; } },
    async descargar(u) { descargadas.push(u); return o.descargas?.[u] ?? { ok: true, bytes: new Uint8Array([1, 2, 3]) }; },
    chatIdAdmin: 7,
    async enviar(_c, t) { if (o.fallaEnviar) throw new Error("tg"); enviados.push(t); },
    async logEvent(x) { eventos.push(x); },
  });
  return { e, guardadas, eventos, enviados, descargadas };
}

describe("entrada de ManyChat (modo sombra)", () => {
  it("descarga las dos fotos y las guarda con su tipo antes de la propuesta", async () => {
    const m = montar();
    await m.e.procesar(S);
    expect(m.guardadas.map((g) => g.tipo).sort()).toEqual(["pelo", "referencia"]);
    expect(m.guardadas.every((g) => g.conv === "conv-1")).toBe(true);
  });

  it("si una foto no se descarga, la otra se guarda igual y el fallo queda anotado sin la dirección completa", async () => {
    const m = montar({ descargas: { [S.fotoPeloUrl!]: { ok: false, motivo: "direccion_no_permitida", dominio: "malo.example" } } });
    await m.e.procesar(S);
    expect(m.guardadas.map((g) => g.tipo)).toEqual(["referencia"]);
    const ev = m.eventos.find((x) => x.kind === "foto_descarga_fallo")!;
    expect(ev.summary).toContain("malo.example");
    expect(JSON.stringify(ev)).not.toContain("pelo.jpg");
  });

  it("sin dirección de foto lo anota y sigue", async () => {
    const m = montar();
    await m.e.procesar({ ...S, fotoReferenciaUrl: null });
    expect(m.guardadas.map((g) => g.tipo)).toEqual(["pelo"]);
    expect(m.eventos.some((x) => x.kind === "foto_ausente")).toBe(true);
  });

  it("si todo falla avisa a Blake (la clienta no recibe nada) y no lanza", async () => {
    const m = montar({ falla: true });
    await expect(m.e.procesar(S)).resolves.toBeUndefined();
    expect(m.enviados[0]).toContain("no he podido prepararla");
    expect(m.enviados[0]).toContain("@clienta");
    expect(m.eventos.some((x) => x.kind === "solicitud_fallo" && x.level === "error")).toBe(true);
  });

  it("si ni el aviso a Blake llega, tampoco lanza", async () => {
    const m = montar({ falla: true, fallaEnviar: true });
    await expect(m.e.procesar(S)).resolves.toBeUndefined();
  });
});
