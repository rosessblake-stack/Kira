import Link from "next/link";
import { notFound } from "next/navigation";
import { detalleConversacion } from "../../../../../lib/panel-data";
import { CANALES, ESTADOS_RESERVA, INTENCIONES, euros, fechaHora, soloFecha } from "../../../../../lib/panel-rules";
import { requireAdmin } from "../../../../../lib/panel-session";
import { Etiqueta, Vacio } from "../../../_components";

export const dynamic = "force-dynamic";

export default async function Conversacion({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const detalle = await detalleConversacion(admin, id);
  if (!detalle) notFound();

  return (
    <>
      <p style={{ marginTop: 18 }}>
        <Link href="/panel/proceso">← Volver a conversaciones</Link>
      </p>
      <div className="fila">
        <h2 style={{ margin: 0 }}>{detalle.nombre}</h2>
        <Etiqueta tono={detalle.paso.tono}>{detalle.paso.etiqueta}</Etiqueta>
      </div>
      <p className="muted">
        {CANALES[detalle.canal] ?? detalle.canal} · {INTENCIONES[detalle.intent] ?? detalle.intent}
      </p>

      <section className="tarjeta" aria-label="Fotos de la clienta">
        <h3 className="subtitulo" style={{ marginTop: 0 }}>Fotos</h3>
        {detalle.fotos.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Todavía no hay fotos en esta conversación.</p>
        ) : (
          <ul className="fotos">
            {detalle.fotos.map((f) => (
              <li key={f.id} className="foto">
                {f.borrada ? (
                  <div className="foto-hueco muted">Foto borrada por caducidad</div>
                ) : (
                  <a href={`/panel/foto/${f.id}`} target="_blank" rel="noopener noreferrer">
                    {/* Detrás del acceso del panel: no puede pasar por el optimizador de imágenes de Next. */}
                    <img src={`/panel/foto/${f.id}`} alt={f.etiqueta} loading="lazy" />
                  </a>
                )}
                <strong>{f.etiqueta}</strong>
                {/* Lo que escribe Blake se pinta como texto plano, igual que todo lo demás. */}
                <p className={f.descripcion ? "texto" : "texto muted"}>{f.descripcion ?? "Sin describir"}</p>
                <span className="muted">{f.borrada ? "Descripción conservada" : f.caduca ? `Se borra el ${soloFecha(f.caduca)}` : "Se conserva siempre"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detalle.reservas.map((r) => (
        <section key={r.id} className="tarjeta" aria-label="Propuesta de cita">
          <div className="fila">
            <strong>
              {r.esPrueba ? "🧪 " : ""}Propuesta: {ESTADOS_RESERVA[r.estado] ?? r.estado}
            </strong>
            <span className="muted">
              {r.inicio ? fechaHora(r.inicio) : "sin fecha"} · {euros(r.precioCentimos)} (señal {euros(r.senalCentimos)})
            </span>
          </div>
          <p className="texto">{r.servicio}</p>

          <h3 className="subtitulo">Lo que Kira entendió</h3>
          <dl className="datos">
            {r.mapeo.map((f) => (
              <div key={f.etiqueta}>
                <dt>{f.etiqueta}</dt>
                <dd className={f.valor === "no indicado" ? "muted" : undefined}>{f.valor}</dd>
              </div>
            ))}
          </dl>

          {r.precio.length > 0 && (
            <>
              <h3 className="subtitulo">Precio</h3>
              <dl className="datos">
                {r.precio.map((f) => (
                  <div key={f.etiqueta}>
                    <dt>{f.etiqueta}</dt>
                    <dd>{f.valor}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {r.avisos.length > 0 && (
            <>
              <h3 className="subtitulo">Avisos</h3>
              <ul className="avisos">
                {r.avisos.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </>
          )}

          {r.borrador && (
            <>
              <h3 className="subtitulo">Borrador de respuesta</h3>
              <p className="texto">{r.borrador}</p>
            </>
          )}
        </section>
      ))}

      <h2>Línea de tiempo</h2>
      {detalle.linea.length === 0 ? (
        <Vacio>Todavía no hay nada registrado en esta conversación.</Vacio>
      ) : (
        <ul className="lista">
          {detalle.linea.map((i, n) => (
            <li
              key={n}
              className={`tarjeta ${i.marcado || i.nivel === "error" ? "error" : i.nivel === "warn" ? "aviso" : ""}`}
            >
              <div className="fila">
                <strong>{i.titulo}</strong>
                <span className="muted">{fechaHora(i.at)}</span>
              </div>
              {i.marcado && <Etiqueta tono="mal">🚩 posible manipulación</Etiqueta>}
              {/* El texto de clientes es dato no fiable: se muestra siempre como texto plano. */}
              {i.texto && <p className="texto">{i.texto}</p>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
