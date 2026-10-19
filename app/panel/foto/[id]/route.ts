import { leerFotoParaPanel } from "../../../../lib/foto-store";
import { requireAdmin } from "../../../../lib/panel-session";

export const dynamic = "force-dynamic";

/**
 * Sirve una foto guardada en el almacén privado. Solo con la sesión de Blake (requireAdmin redirige al acceso si no hay).
 * El tipo sale de la ficha (y esta, de los bytes al guardarla), nunca de lo que traiga el archivo; sandbox + nosniff
 * impiden que el navegador lo trate como otra cosa que una imagen.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await ctx.params;
  const foto = await leerFotoParaPanel(admin, id);
  if (!foto) return new Response("No encontrada", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(foto.bytes as BodyInit, {
    status: 200,
    headers: {
      "content-type": foto.mime,
      "content-length": String(foto.bytes.length),
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
