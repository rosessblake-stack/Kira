import type { ReactNode } from "react";
import { resumenSalud } from "../../../lib/panel-data";
import { requireAdmin } from "../../../lib/panel-session";
import { getPauseState } from "../../../lib/settings";
import { PanelNav } from "../PanelNav";
import { cambiarPausa, cerrarSesion } from "./actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const [pausa, salud] = await Promise.all([getPauseState(), resumenSalud(admin)]);

  return (
    <>
      <header className="cabecera">
        <h1>Kira</h1>
        <form action={cerrarSesion}>
          <button type="submit" className="enlace">
            Cerrar sesión
          </button>
        </form>
      </header>

      <section className={`estado ${pausa.paused ? "pausada" : "activa"}`} aria-label="Estado de Kira">
        <div>
          <strong>{pausa.paused ? "Kira en pausa" : "Kira activa"}</strong>
          <p className="muted">
            {pausa.unknown
              ? "No se pudo leer el ajuste: por seguridad se considera en pausa."
              : pausa.paused
                ? "No contesta a clientes; solo te avisa por Telegram."
                : "Todo pasa por tu botón Aprobar."}
          </p>
          <p className="muted">
            Aún no hay mensajes de clientes conectados: el interruptor ya queda guardado y se aplicará en cuanto
            se conecte Instagram.
          </p>
        </div>
        <form action={cambiarPausa}>
          <input type="hidden" name="pausar" value={pausa.paused ? "0" : "1"} />
          <button type="submit">{pausa.paused ? "Reanudar Kira" : "Pausar Kira"}</button>
        </form>
      </section>

      <PanelNav fallos={salud.fallos} seguridad={salud.seguridad24h} />
      <main>{children}</main>
    </>
  );
}
