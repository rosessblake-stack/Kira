"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Solo pinta la pestaña activa; no recibe ni maneja datos sensibles. */
export function PanelNav({ fallos, seguridad }: { fallos: number; seguridad: number }) {
  const path = usePathname();
  const tabs = [
    { href: "/panel/proceso", etiqueta: "Proceso", aviso: 0 },
    { href: "/panel/fallos", etiqueta: "Fallos", aviso: fallos },
    { href: "/panel/seguridad", etiqueta: "Seguridad", aviso: seguridad },
    { href: "/panel/calendario", etiqueta: "Calendario", aviso: 0 },
  ];
  return (
    <nav className="tabs" aria-label="Secciones del panel">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path.startsWith(t.href) ? "page" : undefined}>
          {t.etiqueta}
          {t.aviso > 0 && <span className="badge" aria-label={`${t.aviso} pendientes`}>{t.aviso}</span>}
        </Link>
      ))}
    </nav>
  );
}
