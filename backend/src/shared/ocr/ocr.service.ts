import { Injectable, Logger } from "@nestjs/common";
import { createWorker } from "tesseract.js";

// OCR de comprobantes de transferencia — tesseract.js corre local en el
// propio proceso (WASM), sin depender de una API de OCR paga (Google
// Vision, etc.) que no tenemos configurada. A esta escala (108 casilleros,
// no miles de imágenes por minuto) un worker por petición es suficiente:
// crear/terminar un worker de tesseract cuesta ~1-2s, aceptable para un
// flujo humano de "subir foto y esperar" que no es de alta frecuencia.
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  async extractText(imageBuffer: Buffer): Promise<string> {
    const worker = await createWorker("spa");
    try {
      const {
        data: { text },
      } = await worker.recognize(imageBuffer);
      return text;
    } catch (err) {
      this.logger.warn(`OCR fallo al procesar la imagen: ${(err as Error).message}`);
      return "";
    } finally {
      await worker.terminate();
    }
  }
}
