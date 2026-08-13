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
    // createWorker es un mock a nivel de módulo (jest.mock arriba) — sin
    // limpiarlo acá, su conteo de llamadas se acumula ENTRE tests (solo
    // `worker` se recrea fresco cada vez). No importaba mientras nada
    // afirmaba sobre createWorker.mock.calls; los tests de reintento sí.
    jest.clearAllMocks();
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

  it("Dado que tesseract lanza un error en AMBOS intentos (imagen corrupta/formato no soportado), Cuando se extrae, Entonces retorna string vacío en vez de propagar la excepción, y libera el worker en cada intento", async () => {
    worker.recognize.mockRejectedValue(new Error("formato de imagen no soportado"));

    const result = await service.extractText(Buffer.from("no-es-una-imagen"));

    expect(result).toBe("");
    expect(worker.terminate).toHaveBeenCalledTimes(2);
  });

  it("Dado que el propio recognize() falla en los dos intentos, Cuando se extrae, Entonces el worker se libera igual (finally) en cada uno — nunca queda un worker de tesseract huérfano consumiendo memoria", async () => {
    worker.recognize.mockRejectedValue(new Error("boom"));

    await service.extractText(Buffer.from("img"));

    expect(worker.terminate).toHaveBeenCalledTimes(2);
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  // Hallazgo real en producción: un comprobante genuino (verificado a mano,
  // mismo motor, misma imagen) fue rechazado justo durante un redeploy con
  // pico de CPU — createWorker()/recognize() puede fallar por presión de
  // recursos aunque la imagen esté perfecta. Este test cubre exactamente
  // ese caso: falla una vez, se recupera con un worker nuevo.
  it("Dado que el primer intento falla pero el segundo tiene éxito (pico de CPU pasajero), Cuando se extrae, Entonces retorna el texto del segundo intento en vez de rendirse en el primero", async () => {
    worker.recognize
      .mockRejectedValueOnce(new Error("recursos insuficientes"))
      .mockResolvedValueOnce({ data: { text: "Transferencia $6.50 exitosa" } });

    const result = await service.extractText(Buffer.from("img"));

    expect(result).toBe("Transferencia $6.50 exitosa");
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(worker.terminate).toHaveBeenCalledTimes(2);
  });
});
