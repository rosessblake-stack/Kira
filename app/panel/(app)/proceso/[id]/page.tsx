import Link from "next/link";
import { notFound } from "next/navigation";
import { detalleConversacion } from "../../../../../lib/panel-data";
import { INTENCIONES, fechaHora } from "../../../../../lib/panel-rules";
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
      <p className="muted">{INTENCIONES[detalle.intent] ?? detalle.intent}</p>

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
