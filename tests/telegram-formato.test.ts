import { describe, expect, it } from "vitest";
import { MAX_DETALLE, escaparHtml, formatoPlegable } from "../lib/telegram-formato";

describe("mensajes plegables de Telegram", () => {
  it("la primera línea es el resumen en negrita y el detalle va en una cita desplegable", () => {
    const t = formatoPlegable("📥 Raúl quiere cita · mié 21 oct", "PROPUESTA\nlínea 2");
    expect(t).toBe("<b>📥 Raúl quiere cita · mié 21 oct</b>\n<blockquote expandable>PROPUESTA\nlínea 2</blockquote>");
  });

  it("todo lo que viene de fuera se escapa: ni etiquetas ni entidades coladas", () => {
    expect(escaparHtml("<b>hola</b> & <a href=x>")).toBe("&lt;b&gt;hola&lt;/b&gt; &amp; &lt;a href=x&gt;");
    const t = formatoPlegable("<i>Ana</i>", "dijo «<script>alert(1)</script> & más»");
    expect(t).not.toContain("<script>");
    expect(t).not.toContain("<i>");
    expect(t).toContain("&lt;script&gt;");
    expect(t.match(/<[a-z/]+/g)).toEqual(["<b", "</b", "<blockquote", "</blockquote"]);
  });

  it("el resumen es de una línea y con tope, y el detalle se recorta para no pasar el límite de Telegram", () => {
    const t = formatoPlegable("a\nb\n" + "x".repeat(500), "y".repeat(10_000));
    expect(t.split("\n")).toHaveLength(2);
    expect(t.length).toBeLessThan(4096);
    expect((t.match(/y/g) ?? []).length).toBe(MAX_DETALLE);
  });
});
