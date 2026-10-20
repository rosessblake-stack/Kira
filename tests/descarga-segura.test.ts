import { afterEach, describe, expect, it } from "vitest";
import { comprobarDireccion, descargarImagenSegura, type FetchDescarga } from "../lib/descarga-segura";

afterEach(() => {
  delete process.env.KIRA_E2E;
});

const cuerpo = (bytes: number[] | Uint8Array, trozos = 1): ReadableStream<Uint8Array> => {
  const b = Uint8Array.from(bytes);
  const tam = Math.ceil(b.length / trozos) || 1;
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= b.length) return c.close();
      c.enqueue(b.slice(i, i + tam));
      i += tam;
    },
  });
};
const resp = (status: number, o: { body?: ReadableStream<Uint8Array> | null; headers?: Record<string, string> } = {}) => ({
  status,
  headers: { get: (n: string) => o.headers?.[n.toLowerCase()] ?? null },
  body: o.body === undefined ? null : o.body,
});

describe("qué direcciones se aceptan", () => {
  it("solo https de Meta/Instagram/ManyChat", () => {
    for (const u of ["https://scontent-mad1-1.cdninstagram.com/v/t51/foto.jpg?x=1", "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1", "https://scontent.xx.fbcdn.net/a.jpg", "https://files.manychat.com/x.png"]) {
      expect(comprobarDireccion(u).ok, u).toBe(true);
    }
  });
  it("rechaza lo demás, sin devolver la dirección entera (solo el dominio)", () => {
    for (const u of [
      "http://scontent.cdninstagram.com/a.jpg", "https://evil.example/a.jpg", "https://fbcdn.net.evil.example/a.jpg", "https://localhost/a.jpg",
      "https://127.0.0.1/a.jpg", "https://169.254.169.254/latest/meta-data", "https://user:pass@scontent.cdninstagram.com/a.jpg", "https://scontent.cdninstagram.com:8443/a.jpg",
      "ftp://scontent.cdninstagram.com/a.jpg", "no es una url", "",
    ]) {
      const r = comprobarDireccion(u);
      expect(r.ok, u).toBe(false);
      if (!r.ok) expect(r.dominio).not.toContain("?");
    }
  });
  it("el servidor falso local solo vale en las pruebas", () => {
    expect(comprobarDireccion("http://127.0.0.1:54399/foto.jpg").ok).toBe(false);
    process.env.KIRA_E2E = "1";
    expect(comprobarDireccion("http://127.0.0.1:54399/foto.jpg").ok).toBe(true);
  });
});

describe("descargarImagenSegura", () => {
  const ok = "https://scontent.cdninstagram.com/a.jpg?token=secreto";

  it("descarga y junta los trozos", async () => {
    const f: FetchDescarga = async () => resp(200, { body: cuerpo([1, 2, 3, 4, 5, 6, 7], 3) });
    const r = await descargarImagenSegura(ok, f);
    expect(r).toEqual({ ok: true, bytes: Uint8Array.from([1, 2, 3, 4, 5, 6, 7]) });
  });

  it("no hace ninguna petición a una dirección no permitida", async () => {
    let llamadas = 0;
    const f: FetchDescarga = async () => { llamadas++; return resp(200, { body: cuerpo([1]) }); };
    const r = await descargarImagenSegura("https://evil.example/a.jpg?permiso=abc", f);
    expect(r).toEqual({ ok: false, motivo: "direccion_no_permitida", dominio: "evil.example" });
    expect(llamadas).toBe(0);
  });

  it("sigue redirecciones a mano y vuelve a comprobar cada salto", async () => {
    const f: FetchDescarga = async (u) => {
      if (u.includes("/a.jpg")) return resp(302, { headers: { location: "https://scontent.fbcdn.net/b.jpg" } });
      return resp(200, { body: cuerpo([9, 9]) });
    };
    expect(await descargarImagenSegura(ok, f)).toEqual({ ok: true, bytes: Uint8Array.from([9, 9]) });
    const g: FetchDescarga = async () => resp(302, { headers: { location: "http://169.254.169.254/latest/meta-data" } });
    expect(await descargarImagenSegura(ok, g)).toMatchObject({ ok: false, motivo: "direccion_no_permitida" });
    const bucle: FetchDescarga = async () => resp(302, { headers: { location: "https://scontent.fbcdn.net/otra.jpg" } });
    expect(await descargarImagenSegura(ok, bucle)).toMatchObject({ ok: false, motivo: "error" });
  });

  it("respeta el tope de tamaño, por cabecera y por lo realmente recibido", async () => {
    const grandeDeclarado: FetchDescarga = async () => resp(200, { body: cuerpo([1]), headers: { "content-length": "999999999" } });
    expect(await descargarImagenSegura(ok, grandeDeclarado, 100)).toMatchObject({ ok: false, motivo: "grande" });
    const grandeReal: FetchDescarga = async () => resp(200, { body: cuerpo(new Uint8Array(500), 5) });
    expect(await descargarImagenSegura(ok, grandeReal, 100)).toMatchObject({ ok: false, motivo: "grande" });
  });

  it("errores de red o de estado: sin detalles ni la dirección entera", async () => {
    const cae: FetchDescarga = async () => { throw new Error("ECONNRESET https://x?permiso=1"); };
    const r = await descargarImagenSegura(ok, cae);
    expect(r).toEqual({ ok: false, motivo: "error", dominio: "scontent.cdninstagram.com" });
    expect(JSON.stringify(r)).not.toContain("secreto");
    const nofound: FetchDescarga = async () => resp(404, { body: null });
    expect(await descargarImagenSegura(ok, nofound)).toMatchObject({ ok: false, motivo: "error" });
  });
});
