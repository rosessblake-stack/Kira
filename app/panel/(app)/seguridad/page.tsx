import Link from "next/link";
import { cargarSeguridad } from "../../../../lib/panel-data";
import { TIPOS_SEGURIDAD, UMBRALES, fechaHora, resumirDetalle } from "../../../../lib/panel-rules";
import { requireAdmin } from "../../../../lib/panel-session";
import { Etiqueta, Vacio } from "../../_components";

export const dynamic = "force-dynamic";

export default async function Seguridad() {
  const admin = await requireAdmin();
  const s = await cargarSeguridad(admin);
  const tipos = Object.keys(TIPOS_SEGURIDAD).filter((k) => s.ultimos7d[k] || s.ultimas24h[k]);

  return (
    <>
      <h2>Resumen</h2>
      {tipos.length === 0 ? (
        <Vacio>Sin incidentes de seguridad en los últimos 7 días.</Vacio>
      ) : (
        <div className="contadores">
          {tipos.map((k) => (
            <div key={k} className="contador">
              <b>{s.ultimas24h[k] ?? 0}</b>
              {TIPOS_SEGURIDAD[k]}
              <div className="muted">últimas 24 h · {s.ultimos7d[k] ?? 0} en 7 días</div>
            </div>
          ))}
        </div>
      )}

      <h2>Mensajes marcados como posible manipulación</h2>
      {s.marcados.length === 0 ? (
        <Vacio>Ninguno. Kira no contesta a estos mensajes: solo te avisa.</Vacio>
      ) : (
        <ul className="lista">
          {s.marcados.map((m) => (
            <li key={m.id} className="tarjeta marcado">
              <div className="fila">
                <Etiqueta tono="mal">🚩 marcado</Etiqueta>
                <span className="muted">{fechaHora(m.created_at)}</span>
              </div>
              {/* Texto del cliente: no fiable, siempre como texto plano y recortado. */}
              <p className="texto">{m.body.length > 400 ? `${m.body.slice(0, 399)}…` : m.body}</p>
              <Link href={`/panel/proceso/${m.conversation_id}`}>Ver conversación</Link>
            </li>
          ))}
        </ul>
      )}

      <h2>Eventos (últimos {UMBRALES.ventanaSeguridadDias} días)</h2>
      {s.eventos.length === 0 ? (
        <Vacio>Sin eventos.</Vacio>
      ) : (
        <ul className="lista">
          {s.eventos.map((e) => {
            const detalle = resumirDetalle(e.detail);
            return (
              <li key={e.id} className="tarjeta">
                <div className="fila">
                  <strong>{TIPOS_SEGURIDAD[e.kind] ?? e.kind}</strong>
                  <span className="muted">{fechaHora(e.at)}</span>
                </div>
                <div className="tecnico">
                  origen: {e.source}
                  {detalle ? ` · ${detalle}` : ""}
                </div>
                {e.conversation_id && <Link href={`/panel/proceso/${e.conversation_id}`}>Ver conversación</Link>}
              </li>
            );
          })}
        </ul>
      )}
      {s.recortado && <p className="muted">Se muestran los {s.eventos.length} más recientes.</p>}
    </>
  );
}
