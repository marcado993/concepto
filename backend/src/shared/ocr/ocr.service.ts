import { Injectable, Logger } from "@nestjs/common";
import { createWorker } from "tesseract.js";

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
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  async extractText(imageBuffer: Buffer): Promise<string> {
    const attempts = 2;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const worker = await createWorker("spa");
      try {
        const {
          data: { text },
        } = await worker.recognize(imageBuffer);
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
