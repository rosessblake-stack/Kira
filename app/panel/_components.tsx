import type { ReactNode } from "react";
import type { Tono } from "../../lib/panel-rules";

export function Etiqueta({ tono, children }: { tono: Tono; children: ReactNode }) {
  return <span className={`etiqueta ${tono}`}>{children}</span>;
}

export function Vacio({ children }: { children: ReactNode }) {
  return <div className="vacio">{children}</div>;
}
