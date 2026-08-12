import { Test } from "@nestjs/testing";
import { createWorker } from "tesseract.js";
import { OcrService } from "./ocr.service";

jest.mock("tesseract.js", () => ({
  createWorker: jest.fn(),
}));

describe("OcrService.extractText", () => {
  let service: OcrService;
  let worker: { recognize: jest.Mock; terminate: jest.Mock };

  beforeEach(async () => {
    worker = { recognize: jest.fn(), terminate: jest.fn().mockResolvedValue(undefined) };
    (createWorker as jest.Mock).mockResolvedValue(worker);

    const moduleRef = await Test.createTestingModule({ providers: [OcrService] }).compile();
    service = moduleRef.get(OcrService);
  });

  it("Dado un worker de tesseract creado en español, Cuando se extrae texto, Entonces pide el idioma 'spa' (comprobantes ecuatorianos)", async () => {
    worker.recognize.mockResolvedValue({ data: { text: "cualquier cosa" } });

    await service.extractText(Buffer.from("img"));

    expect(createWorker).toHaveBeenCalledWith("spa");
  });

  it("Dado que tesseract reconoce texto, Cuando se extrae, Entonces retorna exactamente ese texto y libera el worker", async () => {
    worker.recognize.mockResolvedValue({ data: { text: "Transferencia $6.50 exitosa" } });

    const result = await service.extractText(Buffer.from("img"));

    expect(result).toBe("Transferencia $6.50 exitosa");
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("Dado que tesseract lanza un error (imagen corrupta/formato no soportado), Cuando se extrae, Entonces retorna string vacío en vez de propagar la excepción, y de todos modos libera el worker", async () => {
    worker.recognize.mockRejectedValue(new Error("formato de imagen no soportado"));

    const result = await service.extractText(Buffer.from("no-es-una-imagen"));

    expect(result).toBe("");
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("Dado que el propio recognize() falla, Cuando se extrae, Entonces el worker se libera igual (finally) — nunca queda un worker de tesseract huérfano consumiendo memoria", async () => {
    worker.recognize.mockRejectedValue(new Error("boom"));

    await service.extractText(Buffer.from("img"));

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
