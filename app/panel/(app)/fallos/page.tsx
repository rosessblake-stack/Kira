import Link from "next/link";
import { cargarFallos, problemasDeTelegram } from "../../../../lib/panel-data";
import { fechaHora, hace, ordenar } from "../../../../lib/panel-rules";
import { requireAdmin } from "../../../../lib/panel-session";
import { Etiqueta, Vacio } from "../../_components";

export const dynamic = "force-dynamic";

export default async function Fallos() {
  const admin = await requireAdmin();
  const ahora = new Date();
  const [fallos, telegram] = await Promise.all([cargarFallos(admin), problemasDeTelegram(admin)]);
  const problemas = ordenar([...telegram.problemas, ...fallos.problemas]);

  return (
    <>
      <h2>Sin cerrar ahora mismo</h2>
      {problemas.length === 0 ? (
        <Vacio>Todo en orden: ninguna reserva, tarea ni aviso de Telegram se ha quedado sin cerrar.</Vacio>
      ) : (
        <ul className="lista">
          {problemas.map((p) => (
            <li key={p.clave} className={`tarjeta ${p.gravedad === "error" ? "error" : "aviso"}`}>
              <div className="fila">
                <strong>{p.titulo}</strong>
                <Etiqueta tono={p.gravedad === "error" ? "mal" : "espera"}>
                  {p.gravedad === "error" ? "Error" : "Aviso"}
                </Etiqueta>
              </div>
              <p className="texto">{p.detalle}</p>
              <div className="muted">Desde {hace(p.desde, ahora)}</div>
              {p.conversationId && <Link href={`/panel/proceso/${p.conversationId}`}>Ver conversación</Link>}
            </li>
          ))}
        </ul>
      )}

      <h2>Telegram</h2>
      {telegram.info ? (
        <p className="muted">
          Webhook {telegram.info.registrado ? "registrado" : "NO registrado"} · {telegram.info.pendientes} aviso(s) en
          cola
          {telegram.info.ultimoErrorFecha
            ? ` · último error de entrega: ${fechaHora(telegram.info.ultimoErrorFecha)}`
            : " · sin errores de entrega"}
        </p>
      ) : (
        <p className="muted">No se pudo consultar a Telegram.</p>
      )}

      <h2>Errores y avisos registrados (últimos 7 días)</h2>
      {fallos.registrados.length === 0 ? (
        <Vacio>Ninguno.</Vacio>
      ) : (
        <ul className="lista">
          {fallos.registrados.map((e) => (
            <li key={e.id} className={`tarjeta ${e.level === "error" ? "error" : "aviso"}`}>
              <div className="fila">
                <strong>{e.summary}</strong>
                <span className="muted">{fechaHora(e.at)}</span>
              </div>
              <div className="tecnico">
                {e.source} · {e.kind}
              </div>
              {e.conversation_id && <Link href={`/panel/proceso/${e.conversation_id}`}>Ver conversación</Link>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
