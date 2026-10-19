import { entrar } from "./actions";

export const dynamic = "force-dynamic";

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[]; error?: string | string[] }>;
}) {
  const sp = await searchParams;
  const token = typeof sp.t === "string" ? sp.t.slice(0, 100) : "";
  const fallo = Boolean(sp.error);

  return (
    <main className="centro">
      <h1>Kira</h1>
      {fallo && (
        <p className="alerta" role="alert">
          Ese enlace no es válido o ha caducado. Escribe <code>/panel</code> al bot para recibir uno nuevo.
        </p>
      )}
      {token ? (
        <form action={entrar}>
          <input type="hidden" name="t" value={token} />
          <p>Enlace recibido. Pulsa para entrar al panel.</p>
          <button type="submit">Entrar al panel</button>
        </form>
      ) : (
        <p style={{ marginTop: 18 }}>
          Para entrar, escribe <code>/panel</code> a @KiracitasBot en Telegram y abre el enlace que te mande.
        </p>
      )}
    </main>
  );
}
