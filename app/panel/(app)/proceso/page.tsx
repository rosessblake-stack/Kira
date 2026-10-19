import Link from "next/link";
import { actividadReciente, listarConversaciones } from "../../../../lib/panel-data";
import { INTENCIONES, fechaHora, hace } from "../../../../lib/panel-rules";
import { requireAdmin } from "../../../../lib/panel-session";
import { Etiqueta, Vacio } from "../../_components";

export const dynamic = "force-dynamic";

export default async function Proceso() {
  const admin = await requireAdmin();
  const ahora = new Date();
  const [conversaciones, actividad] = await Promise.all([listarConversaciones(admin), actividadReciente(admin)]);

  return (
    <>
      <h2>Conversaciones</h2>
      {conversaciones.length === 0 ? (
        <Vacio>Todavía no hay conversaciones. Aparecerán aquí cuando lleguen mensajes de Instagram.</Vacio>
      ) : (
        <ul className="lista">
          {conversaciones.map((c) => (
            <li key={c.id}>
              <Link className="tarjeta" href={`/panel/proceso/${c.id}`}>
                <div className="fila">
                  <strong>{c.nombre}</strong>
                  <Etiqueta tono={c.paso.tono}>{c.paso.etiqueta}</Etiqueta>
                </div>
                <div className="muted">
                  {INTENCIONES[c.intent] ?? c.intent} · último mensaje {hace(c.ultimoMensaje, ahora)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2>Actividad reciente</h2>
      {actividad.length === 0 ? (
        <Vacio>Sin actividad registrada.</Vacio>
      ) : (
        <ul className="lista">
          {actividad.map((e) => (
            <li key={e.id} className={`tarjeta ${e.level === "error" ? "error" : e.level === "warn" ? "aviso" : ""}`}>
              <div className="fila">
                <strong>{e.summary}</strong>
                <span className="muted">{fechaHora(e.at)}</span>
              </div>
              <div className="tecnico">
                {e.source} · {e.kind}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
