import { Injectable, Logger } from "@nestjs/common";
import { createWorker } from "tesseract.js";
import sharp from "sharp";

// OCR de comprobantes de transferencia — tesseract.js corre local en el
// propio proceso (WASM), sin depender de una API de OCR paga (Google
// Vision, etc.) que no tenemos configurada. A esta escala (108 casilleros,
// no miles de imágenes por minuto) un worker por petición es suficiente:
// crear/terminar un worker de tesseract cuesta ~1-2s, aceptable para un
// flujo humano de "subir foto y esperar" que no es de alta frecuencia.
//
// Reintento (2 intentos, worker nuevo cada vez): hallazgo real en
// producción — un comprobante genuino (verificado a mano, mismo motor,
// misma imagen) fue rechazado justo durante un redeploy con pico de CPU;
// createWorker()/recognize() puede fallar bajo presión de recursos aunque
// la imagen esté perfecta. Antes esto devolvía "" silenciosamente y el
// estudiante veía "monto no coincide" para un comprobante 100% válido,
// indistinguible de un comprobante genuinamente equivocado.
//
// Preprocesado con sharp antes de leer: hallazgo real distinto (no un
// crash) — un comprobante genuino, subido de verdad por un estudiante, hizo
// que tesseract leyera "$6.50" como "S O. 50" (confundió el dígito 6 con la
// letra O). El fondo del comprobante tiene "BANCO PICHINCHA" repetido en
// diagonal por toda la imagen — ese ruido de fondo confunde el reconocimiento
// de caracteres. Escala de grises + normalizar contraste + agrandar si la
// imagen es chica son técnicas estándar que mejoran la precisión de OCR en
// fotos reales — a diferencia de aflojar receiptMentionsAmount() para
// aceptar "O" como "6" (eso sí sería peligroso: dejaría pasar un
// comprobante de $0.50 como si fuera de $6.50). Arreglar la LECTURA, no la
// validación.
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  private async preprocess(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const image = sharp(imageBuffer).rotate(); // respeta la orientación EXIF real
      const meta = await image.metadata();
      let pipeline = image.greyscale().normalize();
      if (meta.width && meta.width < 1200) {
        pipeline = pipeline.resize({ width: meta.width * 2 });
      }
      return await pipeline.toBuffer();
    } catch (err) {
      // Si sharp no puede procesar la imagen por lo que sea, mejor
      // intentar el OCR con el buffer original que fallar del todo acá.
      this.logger.warn(`Preprocesado de imagen falló, se usa la original: ${(err as Error).message}`);
      return imageBuffer;
    }
  }

  async extractText(imageBuffer: Buffer): Promise<string> {
    const processed = await this.preprocess(imageBuffer);
    const attempts = 2;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const worker = await createWorker("spa");
      try {
        const {
          data: { text },
        } = await worker.recognize(processed);
        return text;
      } catch (err) {
        this.logger.warn(`OCR intento ${attempt}/${attempts} falló: ${(err as Error).message}`);
        if (attempt === attempts) return "";
        await new Promise((resolve) => setTimeout(resolve, 800));
      } finally {
        await worker.terminate();
      }
    }
    return "";
  }
}
