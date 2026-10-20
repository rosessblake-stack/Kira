import { headers } from "next/headers";
import { crearAgendaGoogle } from "../../../../lib/google-agenda";
import { configGoogle, redirectUri } from "../../../../lib/google-oauth";
import { requireAdmin } from "../../../../lib/panel-session";
import { Etiqueta } from "../../_components";
import { comprobar, desconectar } from "./actions";

export const dynamic = "force-dynamic";

/** Mensajes fijos: nada que venga de la dirección se pinta tal cual. */
const AVISOS: Record<string, { tono: "ok" | "mal" | "espera"; texto: string }> = {
  "e:sin_configurar": { tono: "mal", texto: "Todavía no están puestos GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Vercel." },
  "c:desconectado": { tono: "espera", texto: "Calendario desconectado. Las propuestas vuelven a avisar de que la disponibilidad no está comprobada." },
  "c:error": { tono: "mal", texto: "No he podido leer tu agenda. Mira la pestaña Fallos para ver el motivo." },
};

export default async function Calendario({ searchParams }: { searchParams: Promise<{ e?: string; c?: string; n?: string }> }) {
  await requireAdmin();
  const q = await searchParams;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const configurado = configGoogle() !== null;

  let conectado = false;
  let cuenta: string | null = null;
  let ilegible = false;
  if (configurado) {
    try {
      ({ conectado, cuenta } = await crearAgendaGoogle().estado());
    } catch {
      ilegible = true;
    }
  }

  const aviso = q.c === "ok" ? { tono: "ok" as const, texto: `Todo bien: Kira lee tu agenda. Hay ${Number(q.n) >= 0 ? Number(q.n) : 0} eventos en los próximos 7 días.` } : (q.e ? AVISOS[`e:${q.e}`] : q.c ? AVISOS[`c:${q.c}`] : undefined);

  return (
    <>
      <h2>Google Calendar</h2>
      {aviso && (
        <section className="tarjeta">
          <Etiqueta tono={aviso.tono}>{aviso.tono === "ok" ? "✅" : aviso.tono === "mal" ? "⚠️" : "ℹ️"}</Etiqueta> {aviso.texto}
        </section>
      )}

      <section className="tarjeta">
        <div className="fila">
          <strong>Estado</strong>
          {!configurado ? <Etiqueta tono="espera">Sin configurar</Etiqueta> : ilegible ? <Etiqueta tono="mal">No se pudo leer</Etiqueta> : conectado ? <Etiqueta tono="ok">Conectado</Etiqueta> : <Etiqueta tono="espera">Sin conectar</Etiqueta>}
        </div>
        {conectado && <p className="muted">Conectado con {cuenta ?? "una cuenta de Google"}. Cada propuesta mira tu agenda (también las citas marcadas «libre»). Al aprobar se crea la reserva provisional (amarilla); «Señal recibida» la pasa a morado y «Cancelar cita» la borra.</p>}
        {!configurado && <p className="muted">Falta crear el acceso en Google y poner <b>GOOGLE_CLIENT_ID</b> y <b>GOOGLE_CLIENT_SECRET</b> en Vercel (pasos en docs/GOOGLE.md).</p>}
        {configurado && !conectado && !ilegible && <p className="muted">Todo listo para conectar. Entra con la cuenta de Google donde tienes tus citas.</p>}
        {ilegible && <p className="muted">No he podido leer la conexión guardada. Prueba a reconectar.</p>}
      </section>

      {configurado && (
        <section className="tarjeta">
          <div className="fila">
            <a className="boton" href="/api/google/conectar">{conectado ? "Reconectar" : "Conectar Google Calendar"}</a>
            {conectado && (
              <>
                <form action={comprobar}><button type="submit">Comprobar ahora</button></form>
                <form action={desconectar}><button type="submit" className="enlace">Desconectar</button></form>
              </>
            )}
          </div>
        </section>
      )}

      <section className="tarjeta">
        <strong>Dirección de retorno</strong>
        <p className="muted">En Google (Credenciales → tu ID de cliente OAuth), esta debe estar en «URI de redireccionamiento autorizados»:</p>
        <div className="tecnico">{host ? redirectUri(host) : "—"}</div>
      </section>
    </>
  );
}
