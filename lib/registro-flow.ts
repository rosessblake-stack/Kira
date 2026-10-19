import { agruparDatos, etiquetaServicio, lineaRegistro, parsearReal, textoDatos, type DatosReales, type RegistroGuardado } from "./registro";
import { dinero } from "./ubicacion";

/**
 * Los datos reales de cada servicio, por Telegram:
 *   /real                      lista las últimas citas aprobadas, con su número (#12)
 *   /real 12 horas 3,5; materiales 9; precio 80      anota lo que de verdad tardó, gastó y cobró
 *   /datos                     resume, por tipo de servicio, lo que de verdad pasa (solo citas reales)
 * Solo Blake (administrador) puede usarlos; lo que escribe se interpreta con un formato cerrado, nunca como orden.
 */

export interface RegistroDeps {
  now(): Date;
  /** Las últimas citas aprobadas, la más reciente primero. */
  listar(limite: number): Promise<RegistroGuardado[]>;
  leerPorSeq(seq: number): Promise<RegistroGuardado | null>;
  anotar(id: string, patch: { horas_reales?: number; materiales_reales?: number; precio_real_cents?: number; nota_real?: string | null; real_at: string }): Promise<void>;
  /** Servicios con datos reales anotados (sin las pruebas salvo que se pidan) y cuántas pruebas con datos hay. */
  conDatosReales(incluirPruebas: boolean): Promise<{ registros: RegistroGuardado[]; pruebasExcluidas: number }>;
  enviar(chatId: number, texto: string): Promise<number | null>;
  logEvent(e: { source: "telegram"; kind: string; level?: "info" | "warn" | "error"; summary: string; detail?: Record<string, unknown>; booking_id?: string | null }): Promise<void>;
}

export interface RegistroPort {
  real(chatId: number, texto: string): Promise<void>;
  datos(chatId: number, texto: string): Promise<void>;
}

const AYUDA_REAL = "Para anotar lo real de una cita: /real 12 horas 3,5; materiales 9; precio 80\n(el número es el de la lista; puedes poner solo lo que quieras: horas, materiales, precio o nota)";
const decimal = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const msg = (e: unknown) => (e instanceof Error ? e.message : "error desconocido");

export function crearFlujoRegistro(deps: RegistroDeps): RegistroPort {
  async function listar(chatId: number) {
    const ultimos = await deps.listar(8);
    if (!ultimos.length) {
      await deps.enviar(chatId, "Todavía no hay citas aprobadas. Cada vez que apruebes una, la guardo aquí con lo que Kira sugería y lo que dejaste.");
      return;
    }
    await deps.enviar(chatId, `📒 Últimas citas aprobadas\n\n${ultimos.map(lineaRegistro).join("\n\n")}\n\n${AYUDA_REAL}`.slice(0, 3900));
  }

  async function real(chatId: number, textoBruto: string): Promise<void> {
    try {
      const texto = textoBruto.trim();
      if (!texto) return await listar(chatId);

      const m = /^#?(\d{1,9})(?:\s+([\s\S]*))?$/.exec(texto);
      if (!m) {
        await deps.enviar(chatId, `No he entendido el número de la cita.\n\n${AYUDA_REAL}`);
        return;
      }
      const seq = Number(m[1]);
      const registro = await deps.leerPorSeq(seq);
      if (!registro) {
        await deps.enviar(chatId, `No encuentro la cita #${seq}. Mira los números con /real.`);
        return;
      }
      const resto = (m[2] ?? "").trim();
      if (!resto) {
        await deps.enviar(chatId, `${lineaRegistro(registro)}\n\n${AYUDA_REAL}`);
        return;
      }

      const { datos, errores } = parsearReal(resto);
      const hay = Object.keys(datos).length > 0;
      if (!hay) {
        await deps.enviar(chatId, `No he anotado nada:\n• ${errores.join("\n• ") || "no he entendido el mensaje"}\n\n${AYUDA_REAL}`);
        return;
      }
      await deps.anotar(registro.id, {
        ...(datos.horas !== undefined ? { horas_reales: datos.horas } : {}),
        ...(datos.materiales !== undefined ? { materiales_reales: datos.materiales } : {}),
        ...(datos.precioCents !== undefined ? { precio_real_cents: datos.precioCents } : {}),
        ...(datos.nota !== undefined ? { nota_real: datos.nota } : {}),
        real_at: deps.now().toISOString(),
      });
      await deps.logEvent({
        source: "telegram",
        kind: "datos_reales_anotados",
        summary: `Blake anotó los datos reales de la cita #${seq}`,
        detail: { seq, campos: Object.keys(datos), es_prueba: registro.is_test },
        booking_id: registro.booking_id,
      });
      await deps.enviar(chatId, resumenAnotado(registro, datos, errores));
    } catch (e) {
      await deps.logEvent({ source: "telegram", kind: "datos_reales_fallo", level: "error", summary: msg(e) });
      await deps.enviar(chatId, "No he podido anotarlo (error al guardar). Prueba otra vez en un momento.");
    }
  }

  async function datos(chatId: number, texto: string): Promise<void> {
    try {
      const incluirPruebas = /^(pruebas?|todo|todos)$/i.test(texto.trim());
      const { registros, pruebasExcluidas } = await deps.conDatosReales(incluirPruebas);
      await deps.enviar(chatId, textoDatos(agruparDatos(registros), incluirPruebas ? 0 : pruebasExcluidas).slice(0, 3900));
    } catch (e) {
      await deps.logEvent({ source: "telegram", kind: "datos_fallo", level: "error", summary: msg(e) });
      await deps.enviar(chatId, "No he podido leer los datos. Prueba otra vez en un momento.");
    }
  }

  return { real, datos };
}

function resumenAnotado(r: RegistroGuardado, d: DatosReales, errores: string[]): string {
  const partes = [
    d.horas !== undefined ? `horas ${decimal(d.horas)}` : null,
    d.materiales !== undefined ? `materiales ${dinero(Math.round(d.materiales * 100), r.moneda)}` : null,
    d.precioCents !== undefined ? `cobrado ${dinero(d.precioCents, r.moneda)}` : null,
    d.nota !== undefined ? (d.nota ? "nota" : "nota borrada") : null,
  ].filter(Boolean);
  const l = [`✅ Anotado en #${r.seq} (${r.client_name ?? "sin nombre"} · ${etiquetaServicio(r)}): ${partes.join(" · ")}.`];
  if (d.horas !== undefined && r.horas_aprobadas !== null && Math.abs(d.horas - r.horas_aprobadas) >= 0.5) {
    l.push(`Habías aprobado ${decimal(r.horas_aprobadas)} h: tardó ${decimal(Math.abs(d.horas - r.horas_aprobadas))} h ${d.horas > r.horas_aprobadas ? "más" : "menos"}.`);
  }
  if (r.is_test) l.push("🧪 Es de una prueba: lo guardo, pero no cuenta para calibrar.");
  if (errores.length) l.push(`⚠️ No he podido anotar:\n• ${errores.join("\n• ")}`);
  return l.join("\n");
}
