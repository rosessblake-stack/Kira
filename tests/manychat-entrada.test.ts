import { describe, expect, it } from "vitest";
import { asumirTipoTrenzado } from "../lib/intents";
import { componerMensaje, largoComoTexto, leerSolicitud } from "../lib/manychat-entrada";

const plano = {
  id: "1234567890",
  ig_username: "clienta.ig",
  email: "michael@example.com",
  Nombre: "Michael",
  "pais de cliente": "España",
  "Referencia_Diseño": "https://scontent.cdninstagram.com/ref.jpg",
  Estado_Cabello: "https://scontent.cdninstagram.com/pelo.jpg",
  uso_extensiones: "SI",
  color_extensiones: "rojo",
  Largo_trenzas: "Cintura",
  Fecha_texto: "el 20 de octubre a las 12pm",
};

describe("leerSolicitud: las formas que puede mandar ManyChat", () => {
  it("JSON plano", () => {
    const r = leerSolicitud(plano);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.solicitud).toMatchObject({
      contactoId: "1234567890", instagram: "clienta.ig", email: "michael@example.com", nombre: "Michael", ubicacion: "espana",
      ubicacionDudosa: false, usoExtensiones: "si", colorExtensiones: "rojo", largo: "Cintura", fechaTexto: "el 20 de octubre a las 12pm",
      fotoReferenciaUrl: "https://scontent.cdninstagram.com/ref.jpg", fotoPeloUrl: "https://scontent.cdninstagram.com/pelo.jpg",
    });
  });

  it("datos completos del contacto con custom_fields como objeto", () => {
    const { id, ig_username, email, ...campos } = plano;
    const r = leerSolicitud({ id, ig_username, email, first_name: "Otro", custom_fields: campos });
    expect(r.ok && r.solicitud.nombre).toBe("Michael"); // el campo «Nombre» manda sobre first_name
    expect(r.ok && r.solicitud.largo).toBe("Cintura");
  });

  it("datos completos del contacto con custom_fields como lista {name, value}", () => {
    const { id, ig_username, email, ...campos } = plano;
    const lista = Object.entries(campos).map(([name, value], i) => ({ id: i, name, type: "text", value }));
    const r = leerSolicitud({ id, ig_username, email, custom_fields: lista });
    expect(r.ok && r.solicitud.fechaTexto).toBe("el 20 de octubre a las 12pm");
    expect(r.ok && r.solicitud.contactoId).toBe("1234567890");
  });

  it("no distingue mayúsculas, acentos ni espacios en los nombres", () => {
    const r = leerSolicitud({ ID: "42", "PAÍS DE CLIENTE": "Miami", "referencia diseño": "https://x.fbcdn.net/a.jpg" });
    expect(r.ok && r.solicitud.ubicacion).toBe("miami");
    expect(r.ok && r.solicitud.fotoReferenciaUrl).toContain("fbcdn.net");
  });

  it("los marcadores sin sustituir de ManyChat cuentan como vacío", () => {
    const r = leerSolicitud({ ...plano, Nombre: "{{cuf_123}}", email: "{{email}}" });
    expect(r.ok && r.solicitud.nombre).toBeNull();
    expect(r.ok && r.solicitud.email).toBeNull();
  });
});

describe("leerSolicitud: valores estrictos", () => {
  it("sin id de contacto o con un id raro, se rechaza", () => {
    expect(leerSolicitud({ ...plano, id: "" }).ok).toBe(false);
    expect(leerSolicitud({ ...plano, id: "a b; drop table" }).ok).toBe(false);
    const { id, ...sinId } = plano;
    void id;
    expect(leerSolicitud(sinId).ok).toBe(false);
  });

  it("lo que no es un objeto se rechaza", () => {
    for (const x of [null, "texto", 5, [1, 2], undefined]) expect(leerSolicitud(x).ok).toBe(false);
  });

  it("email e Instagram con mal formato se descartan (no se inventan)", () => {
    const r = leerSolicitud({ ...plano, email: "no-es-un-email", ig_username: "con espacios y <script>" });
    expect(r.ok && r.solicitud.email).toBeNull();
    expect(r.ok && r.solicitud.instagram).toBeNull();
  });

  it("el @ del usuario se quita", () => {
    const r = leerSolicitud({ ...plano, ig_username: "@clienta.ig" });
    expect(r.ok && r.solicitud.instagram).toBe("clienta.ig");
  });

  it("las direcciones de foto solo valen si son http(s); lo demás queda en null", () => {
    const r = leerSolicitud({ ...plano, Referencia_Diseño: "javascript:alert(1)", Estado_Cabello: "file:///etc/passwd" });
    expect(r.ok && r.solicitud.fotoReferenciaUrl).toBeNull();
    expect(r.ok && r.solicitud.fotoPeloUrl).toBeNull();
  });

  it("el texto libre se limpia y se recorta", () => {
    const r = leerSolicitud({ ...plano, Nombre: "Mi\nchael\u0000" + "x".repeat(200), color_extensiones: "r".repeat(500) });
    expect(r.ok && r.solicitud.nombre).not.toMatch(/[\u0000-\u001f]/);
    expect(r.ok && r.solicitud.nombre!.length).toBeLessThanOrEqual(60);
    expect(r.ok && r.solicitud.colorExtensiones!.length).toBeLessThanOrEqual(80);
  });

  it("país desconocido: se toma España pero se marca como dudoso", () => {
    const r = leerSolicitud({ ...plano, "pais de cliente": "Narnia" });
    expect(r.ok && r.solicitud.ubicacion).toBe("espana");
    expect(r.ok && r.solicitud.ubicacionDudosa).toBe(true);
  });

  it("extensiones: SI / NO / otra cosa", () => {
    expect(leerSolicitud({ ...plano, uso_extensiones: "NO" }).ok && true).toBe(true);
    const no = leerSolicitud({ ...plano, uso_extensiones: "NO" });
    expect(no.ok && no.solicitud.usoExtensiones).toBe("no");
    const raro = leerSolicitud({ ...plano, uso_extensiones: "quizás" });
    expect(raro.ok && raro.solicitud.usoExtensiones).toBeNull();
  });
});

describe("el mensaje compuesto para el clasificador", () => {
  it("lleva los datos y la regla de las trenzas NO se dispara por nuestra plantilla", () => {
    const r = leerSolicitud(plano);
    if (!r.ok) throw new Error("debería leerse");
    const t = r.solicitud.texto;
    expect(t).toContain("Email: michael@example.com");
    expect(t).toContain("Instagram: @clienta.ig");
    expect(t).toContain("sí quiere extensiones");
    expect(t.toLowerCase()).not.toMatch(/trenza|braid/);
    expect(asumirTipoTrenzado(null, t)).toBeNull();
  });

  it("si la clienta escribe «trenzas» en un campo libre, la regla de Blake sí se aplica a lo que ella dijo", () => {
    const t = componerMensaje({ nombre: "A", instagram: null, email: null, usoExtensiones: null, colorExtensiones: "unas trenzas rojas", largo: null, fechaTexto: null });
    expect(asumirTipoTrenzado(null, t)?.tipo).toBe("sueltas");
  });

  it("los botones del largo se traducen conservando lo que eligió", () => {
    expect(largoComoTexto("Nuca")).toBe("hasta la nuca");
    expect(largoComoTexto("Media espalda")).toBe("hasta media espalda");
    expect(largoComoTexto("Cintura")).toContain("caderas");
    expect(largoComoTexto("Cintura")).toContain("«Cintura»");
    expect(largoComoTexto("Debajo del culo")).toContain("más largo que las caderas");
    expect(largoComoTexto("otra cosa")).toBe("otra cosa");
  });
});

import { leerRespuesta, TEXTO_SIN_TEXTO } from "../lib/manychat-entrada";

describe("leerRespuesta: lo que la clienta escribe después del flujo", () => {
  it("el id y el texto, con el nombre que use ManyChat", () => {
    expect(leerRespuesta({ id: "123", texto: "vale" })).toEqual({ ok: true, respuesta: { contactoId: "123", texto: "vale" } });
    expect(leerRespuesta({ id: "123", last_input_text: "confirmado" })).toEqual({ ok: true, respuesta: { contactoId: "123", texto: "confirmado" } });
  });
  it("sin id, con un id raro o sin texto se rechaza", () => {
    expect(leerRespuesta({ texto: "vale" }).ok).toBe(false);
    expect(leerRespuesta({ id: "a b", texto: "vale" }).ok).toBe(false);
    // una foto o un audio llegan sin texto: no es un ataque, se pasa a Blake con una etiqueta
    expect(leerRespuesta({ id: "123", texto: "   " })).toMatchObject({ ok: true, respuesta: { texto: TEXTO_SIN_TEXTO } });
    expect(leerRespuesta({ id: "123", texto: "https://cdn.fbsbx.com/audio.mp4" })).toMatchObject({ ok: true, respuesta: { texto: TEXTO_SIN_TEXTO } });
    // ManyChat deja el marcador sin sustituir cuando el campo viene vacío (típico de un audio): igual que sin texto
    expect(leerRespuesta({ id: "123", texto: "{{last_input_text}}" })).toMatchObject({ ok: true, respuesta: { texto: TEXTO_SIN_TEXTO } });
    expect(leerRespuesta("hola").ok).toBe(false);
  });
  it("el texto se limpia y se recorta", () => {
    const r = leerRespuesta({ id: "1", texto: "vale\u0000\n" + "x".repeat(900) });
    expect(r.ok && r.respuesta.texto.length).toBeLessThanOrEqual(600);
    expect(r.ok && r.respuesta.texto).not.toMatch(/[\u0000-\u001f]/);
  });
});

describe("botones de estilo y número de trenzas", () => {
  it("«Flat twist» y «6» llegan como estilo y número", async () => {
    const { leerSolicitud } = await import("../lib/manychat-entrada");
    const r = leerSolicitud({ id: "mc-1", Estilo_Trenzas: "Flat twist", Num_Trenzas: "6" });
    expect(r.ok && r.solicitud.estilo).toBe("twist");
    expect(r.ok && r.solicitud.numeroTrenzas).toBe(6);
    const b = leerSolicitud({ id: "mc-1", Estilo_Trenzas: "Barrel Twist", Num_Trenzas: "Otro" });
    expect(b.ok && b.solicitud.estilo).toBe("barrel_twist");
    expect(b.ok && b.solicitud.numeroTrenzas).toBeNull();
    const n = leerSolicitud({ id: "mc-1", Estilo_Trenzas: "No sé", Num_Trenzas: "{{Num_Trenzas}}" });
    expect(n.ok && n.solicitud.estilo).toBeNull();
    expect(n.ok && n.solicitud.numeroTrenzas).toBeNull();
  });
});

describe("nombre escrito a mano en ManyChat", () => {
  it("«First Name» literal no es un nombre: se ignora", () => {
    for (const n of ["First Name", "first_name", "{{first_name}}", "Nombre"]) {
      const r = leerSolicitud({ id: "123", ig_username: "ana", nombre: n });
      expect(r.ok && r.solicitud.nombre, n).toBeNull();
    }
    const ok = leerSolicitud({ id: "123", ig_username: "ana", nombre: "Elizabeth" });
    expect(ok.ok && ok.solicitud.nombre).toBe("Elizabeth");
  });
});

import { leerDatosCita } from "../lib/manychat-entrada";

describe("leerDatosCita (flujo «¿cómo te apunto y a qué correo?»)", () => {
  it("acepta nombre y correo válidos", () => {
    expect(leerDatosCita({ id: "123456", nombre: "Ana María", email: " Ana@Correo.com " })).toEqual({ ok: true, contactoId: "123456", nombre: "Ana María", email: "ana@correo.com" });
  });
  it("sin correo válido no vale; un nombre raro se descarta pero el correo se guarda", () => {
    expect(leerDatosCita({ id: "123456", nombre: "Ana", email: "no es correo" })).toMatchObject({ ok: false, motivo: "correo_no_valido" });
    expect(leerDatosCita({ id: "123456", nombre: "First Name", email: "a@b.es" })).toMatchObject({ ok: true, nombre: null });
    expect(leerDatosCita({ id: "123456", nombre: "http://x.com", email: "a@b.es" })).toMatchObject({ ok: true, nombre: null });
    expect(leerDatosCita({ nombre: "Ana", email: "a@b.es" })).toMatchObject({ ok: false });
  });
});
