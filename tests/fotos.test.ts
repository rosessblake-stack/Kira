import { describe, expect, it } from "vitest";
import {
  MAX_DESCRIPCION,
  RETENCION_DIAS,
  caducaEl,
  detectarImagen,
  esUuid,
  interpretarPieDeFoto,
  rutaAlmacenamiento,
  sha256Hex,
  siguienteTipo,
} from "../lib/fotos";

const bytes = (...n: number[]) => Uint8Array.from(n);
const ascii = (t: string) => [...t].map((c) => c.charCodeAt(0));
const CONV = "11111111-1111-4111-8111-111111111111";
const FOTO = "22222222-2222-4222-8222-222222222222";

describe("detectarImagen: el tipo lo dicen los bytes", () => {
  it("reconoce JPEG, PNG y WebP", () => {
    expect(detectarImagen(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))).toEqual({ mime: "image/jpeg", ext: "jpg" });
    expect(detectarImagen(bytes(0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a, 0))).toEqual({ mime: "image/png", ext: "png" });
    expect(detectarImagen(bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBP"), 0))).toEqual({ mime: "image/webp", ext: "webp" });
  });

  it("rechaza lo que no es una de esas imágenes aunque se disfrace", () => {
    expect(detectarImagen(bytes(...ascii("GIF89a")))).toBeNull(); // gif
    expect(detectarImagen(bytes(...ascii("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>")))).toBeNull();
    expect(detectarImagen(bytes(...ascii("<!doctype html><script>alert(1)</script>")))).toBeNull();
    expect(detectarImagen(bytes(...ascii("%PDF-1.7")))).toBeNull();
    expect(detectarImagen(bytes(...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVE")))).toBeNull(); // RIFF pero audio
    expect(detectarImagen(bytes(0x89, ...ascii("PNG")))).toBeNull(); // cabecera PNG incompleta
  });

  it("vacío o demasiado corto: null", () => {
    expect(detectarImagen(bytes())).toBeNull();
    expect(detectarImagen(bytes(0xff, 0xd8))).toBeNull();
    expect(detectarImagen(bytes(...ascii("RIFFWEBP")))).toBeNull();
  });
});

describe("sha256Hex", () => {
  it("es el hash conocido de «abc» y siempre 64 caracteres hexadecimales", () => {
    expect(sha256Hex(Uint8Array.from(ascii("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(bytes(1, 2, 3))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("rutaAlmacenamiento: solo identificadores nuestros", () => {
  it("compone conversación/foto.extensión", () => {
    expect(rutaAlmacenamiento(CONV, FOTO, "jpg")).toBe(`${CONV}/${FOTO}.jpg`);
  });
  it("rechaza identificadores que no son UUID (nada de ../ ni nombres del archivo)", () => {
    expect(() => rutaAlmacenamiento("../etc", FOTO, "jpg")).toThrow();
    expect(() => rutaAlmacenamiento(CONV, "foto.jpg", "jpg")).toThrow();
    expect(() => rutaAlmacenamiento(`${CONV}/..`, FOTO, "png")).toThrow();
  });
  it("esUuid", () => {
    expect(esUuid(CONV)).toBe(true);
    expect(esUuid("no-es-uuid")).toBe(false);
    expect(esUuid(`${CONV}x`)).toBe(false);
  });
});

describe("caducidad", () => {
  it(`la foto caduca a los ${RETENCION_DIAS} días`, () => {
    const hoy = new Date("2026-10-19T12:00:00Z");
    expect(caducaEl(hoy).toISOString()).toBe("2026-12-18T12:00:00.000Z");
  });
});

describe("siguienteTipo", () => {
  it("primera pelo, segunda referencia, resto otra", () => {
    expect(siguienteTipo([])).toBe("pelo");
    expect(siguienteTipo(["pelo"])).toBe("referencia");
    expect(siguienteTipo(["pelo", "referencia"])).toBe("otra");
    expect(siguienteTipo(["referencia"])).toBe("pelo");
    expect(siguienteTipo(["otra", "otra"])).toBe("pelo");
  });
});

describe("interpretarPieDeFoto: lo que Blake escribe al mandar la foto", () => {
  it("sin pie: nada", () => {
    expect(interpretarPieDeFoto("")).toEqual({ tipo: null, descripcion: null });
    expect(interpretarPieDeFoto("   \n ")).toEqual({ tipo: null, descripcion: null });
  });
  it("«pelo: …» fija el tipo y deja el resto como descripción", () => {
    expect(interpretarPieDeFoto("pelo: rizado, fino, a los hombros")).toEqual({ tipo: "pelo", descripcion: "rizado, fino, a los hombros" });
    expect(interpretarPieDeFoto("Pelo rizado fino")).toEqual({ tipo: "pelo", descripcion: "rizado fino" });
    expect(interpretarPieDeFoto("cabello - liso con volumen")).toEqual({ tipo: "pelo", descripcion: "liso con volumen" });
  });
  it("«referencia» y «trenzas» son lo mismo; «otra» también existe", () => {
    expect(interpretarPieDeFoto("referencia: boxeadoras hasta la cadera")).toEqual({ tipo: "referencia", descripcion: "boxeadoras hasta la cadera" });
    expect(interpretarPieDeFoto("trenzas boxeadoras")).toEqual({ tipo: "referencia", descripcion: "boxeadoras" });
    expect(interpretarPieDeFoto("otra: detrás de la oreja")).toEqual({ tipo: "otra", descripcion: "detrás de la oreja" });
  });
  it("solo la palabra del tipo: fija el tipo y no hay descripción", () => {
    expect(interpretarPieDeFoto("pelo")).toEqual({ tipo: "pelo", descripcion: null });
    expect(interpretarPieDeFoto("REFERENCIA:")).toEqual({ tipo: "referencia", descripcion: null });
  });
  it("si no empieza por una palabra de tipo, todo es descripción y el tipo se decide solo", () => {
    expect(interpretarPieDeFoto("rizado y fino")).toEqual({ tipo: null, descripcion: "rizado y fino" });
    expect(interpretarPieDeFoto("peloton de trenzas")).toEqual({ tipo: null, descripcion: "peloton de trenzas" }); // «peloton» no es «pelo»
    expect(interpretarPieDeFoto("pelos rizados")).toEqual({ tipo: null, descripcion: "pelos rizados" });
  });
  it("limpia saltos y caracteres de control y respeta el tope", () => {
    expect(interpretarPieDeFoto("pelo:\u0000 rizado\n\nfino ")).toEqual({ tipo: "pelo", descripcion: "rizado fino" });
    const larga = interpretarPieDeFoto(`pelo: ${"a".repeat(5000)}`);
    expect(larga.descripcion!.length).toBe(MAX_DESCRIPCION);
  });
});
