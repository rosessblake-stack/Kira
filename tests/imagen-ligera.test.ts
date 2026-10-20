import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { detectarImagen } from "../lib/fotos";
import { LADO_MAX_PX, reducirParaClaude } from "../lib/imagen-ligera";

const foto = (w: number, h: number, formato: "jpeg" | "png" = "jpeg") =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 120, b: 120 }, noise: { type: "gaussian", mean: 128, sigma: 60 } } })[formato]().toBuffer();

describe("reducir las fotos antes de mandárselas a Claude", () => {
  it("una foto grande queda con el lado mayor en 1024 px y mucho más ligera, en JPEG", async () => {
    const original = await foto(3000, 2000);
    const r = await reducirParaClaude(original);
    expect(r).not.toBeNull();
    expect(detectarImagen(r!.bytes)?.mime).toBe("image/jpeg");
    const m = await sharp(r!.bytes).metadata();
    expect(Math.max(m.width!, m.height!)).toBe(LADO_MAX_PX);
    expect(m.width! / m.height!).toBeCloseTo(1.5, 1); // conserva la proporción
    expect(r!.bytes.length).toBeLessThan(original.length / 5);
  });

  it("una foto vertical (la típica del móvil) también", async () => {
    const m = await sharp((await reducirParaClaude(await foto(1500, 3000)))!.bytes).metadata();
    expect(m.height).toBe(LADO_MAX_PX);
    expect(m.width).toBe(512);
  });

  it("una foto pequeña no se agranda", async () => {
    const m = await sharp((await reducirParaClaude(await foto(400, 300)))!.bytes).metadata();
    expect([m.width, m.height]).toEqual([400, 300]);
  });

  it("acepta PNG y lo devuelve como JPEG", async () => {
    const r = await reducirParaClaude(await foto(2000, 2000, "png"));
    expect(detectarImagen(r!.bytes)?.mime).toBe("image/jpeg");
  });

  it("lo que no es una imagen (o está roto) devuelve null: nunca se envía el original", async () => {
    expect(await reducirParaClaude(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(await reducirParaClaude(new Uint8Array(0))).toBeNull();
    const rota = (await foto(800, 800)).subarray(0, 300);
    expect(await reducirParaClaude(new Uint8Array(rota))).toBeNull();
  });
});
