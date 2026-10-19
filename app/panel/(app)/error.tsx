"use client";

/** No se muestra el mensaje del error: podría contener detalles internos. */
export default function PanelError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="vacio" role="alert">
      <p>No se han podido cargar los datos. Puede ser algo pasajero.</p>
      <button type="button" onClick={reset}>
        Reintentar
      </button>
    </div>
  );
}
