import type { ReactNode } from "react";
import "./panel.css";

export default function PanelRoot({ children }: { children: ReactNode }) {
  return <div className="panel">{children}</div>;
}
