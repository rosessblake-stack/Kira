import sharp from "sharp";

/**
 * Las fotos que se le mandan a Claude se reducen antes: una imagen se cobra por su tamaño (≈ ancho×alto/750 tokens) y una foto de
 * Instagram trae muchos más píxeles de los que hacen falta para reconocer un peinado. La reducción NO cambia lo que se guarda (el
 * original sigue en el almacén privado): solo lo que se envía a leer. Una imagen que llega de fuera es dato no fiable: tope de
 * píxeles (contra «bombas» de descompresión) y, si no se puede procesar, no se envía nada (nunca el original sin tocar).
 */

export const LADO_MAX_PX = 1024;
export const CALIDAD_JPEG = 75;
const MAX_PIXELES_ENTRADA = 50_000_000;

export type ImagenLigera = { bytes: Uint8Array; mime: "image/jpeg" };

export async function reducirParaClaude(bytes: Uint8Array, ladoMax: number = LADO_MAX_PX): Promise<ImagenLigera | null> {
  try {
    const salida = await sharp(bytes, { limitInputPixels: MAX_PIXELES_ENTRADA, failOn: "error" })
      .rotate() // respeta la orientación del móvil y quita el resto de metadatos (ubicación, etc.)
      .resize({ width: ladoMax, height: ladoMax, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: CALIDAD_JPEG })
      .toBuffer();
    return salida.length > 0 ? { bytes: new Uint8Array(salida), mime: "image/jpeg" } : null;
  } catch {
    return null;
  }
}
