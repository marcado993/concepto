import { PayphoneClient } from "./payphone.client";

const ORIGINAL_ENV = process.env;

function mockFetchResolved(status: number, body: unknown, jsonThrows = false) {
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jsonThrows ? jest.fn().mockRejectedValue(new Error("body no es JSON")) : jest.fn().mockResolvedValue(body),
  });
}

describe("PayphoneClient.getPublicConfig", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("Dados PAYPHONE_TOKEN y PAYPHONE_STORE_ID configurados, Cuando se pide la config pública, Entonces configured:true", () => {
    process.env = { ...ORIGINAL_ENV, PAYPHONE_TOKEN: "tok", PAYPHONE_STORE_ID: "store" };
    expect(new PayphoneClient().getPublicConfig()).toEqual({ configured: true, token: "tok", storeId: "store" });
  });

  it.each([
    ["PAYPHONE_TOKEN", "PAYPHONE_STORE_ID"],
    ["PAYPHONE_STORE_ID", "PAYPHONE_TOKEN"],
  ])("Dado que falta %s, Cuando se pide la config pública, Entonces configured:false aunque %s SÍ esté puesto", (missing, present) => {
    process.env = { ...ORIGINAL_ENV, [present]: "algo" };
    delete process.env[missing];
    expect(new PayphoneClient().getPublicConfig().configured).toBe(false);
  });
});

describe("PayphoneClient.confirm", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, PAYPHONE_TOKEN: "test-token" };
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it("Dado que PAYPHONE_TOKEN no está configurado, Cuando se intenta confirmar, Entonces rechaza SIN llegar a llamar a PayPhone", async () => {
    delete process.env.PAYPHONE_TOKEN;
    const fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;

    await expect(new PayphoneClient().confirm(1, "rental-1")).rejects.toThrow("PAYPHONE_TOKEN no está configurado");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Dado que la red falla (fetch rechaza, ej. timeout/DNS), Cuando se confirma, Entonces lanza un error genérico — nunca el error crudo de fetch", async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED"));

    await expect(new PayphoneClient().confirm(1, "rental-1")).rejects.toThrow(
      "No se pudo contactar a PayPhone para confirmar el pago"
    );
  });

  it("Dado que PayPhone responde con un body que no es JSON válido, Cuando se confirma, Entonces lo trata como rechazo (nunca lanza un error de parseo sin manejar)", async () => {
    mockFetchResolved(200, null, true);

    await expect(new PayphoneClient().confirm(1, "rental-1")).rejects.toThrow(
      "PayPhone rechazó la confirmación de la transacción"
    );
  });

  it("Dado un status HTTP no-2xx (ej. 401 credenciales malas), Cuando se confirma, Entonces rechaza aunque el body tenga forma de éxito", async () => {
    mockFetchResolved(401, { transactionStatus: "Approved", statusCode: 3 });

    await expect(new PayphoneClient().confirm(1, "rental-1")).rejects.toThrow();
  });

  it("Dado un body con errorCode presente AUNQUE res.ok sea true, Cuando se confirma, Entonces igual lo rechaza (PayPhone puede mandar 200 con error)", async () => {
    mockFetchResolved(200, { errorCode: "TX_NOT_FOUND", message: "Transacción no encontrada" });

    await expect(new PayphoneClient().confirm(1, "rental-1")).rejects.toThrow("Transacción no encontrada");
  });

  it("Dado un rechazo sin campo message, Cuando se confirma, Entonces usa el mensaje genérico — nunca 'undefined' ni un mensaje vacío", async () => {
    mockFetchResolved(200, { errorCode: "X" });

    await expect(new PayphoneClient().confirm(1, "rental-1")).rejects.toThrow(
      "PayPhone rechazó la confirmación de la transacción"
    );
  });

  it("Dado transactionStatus Approved Y statusCode 3, Cuando se confirma, Entonces approved:true", async () => {
    mockFetchResolved(200, {
      transactionStatus: "Approved",
      statusCode: 3,
      transactionId: 999,
      clientTransactionId: "rental-1",
      amount: 650,
    });

    const result = await new PayphoneClient().confirm(999, "rental-1");
    expect(result.approved).toBe(true);
  });

  const notApprovedCases: [string, number | undefined, string][] = [
    ["Approved", 1, "statusCode correcto pero DISTINTO de 3"],
    ["Approved", undefined, "statusCode ausente"],
    ["Pending", 3, "statusCode 3 pero transactionStatus NO es Approved — no basta con uno de los dos"],
    ["approved", 3, "transactionStatus en minúscula — no hay tolerancia de mayúsculas, tiene que calzar exacto"],
  ];

  it.each(notApprovedCases)(
    "Dado transactionStatus=%j y statusCode=%j (%s), Cuando se confirma, Entonces approved:false — AMBAS condiciones son obligatorias",
    async (transactionStatus, statusCode) => {
      mockFetchResolved(200, { transactionStatus, statusCode, transactionId: 1, clientTransactionId: "rental-1", amount: 650 });
      const result = await new PayphoneClient().confirm(1, "rental-1");
      expect(result.approved).toBe(false);
    }
  );

  it("Dado que PayPhone no manda clientTransactionId en la respuesta, Cuando se confirma, Entonces el campo queda como el string literal 'undefined' — nunca calza con un id real, falla cerrado por diseño", async () => {
    mockFetchResolved(200, { transactionStatus: "Approved", statusCode: 3, transactionId: 1, amount: 650 });

    const result = await new PayphoneClient().confirm(1, "rental-1");
    expect(result.clientTransactionId).toBe("undefined");
    expect(result.clientTransactionId).not.toBe("rental-1");
  });

  it("Cuando se confirma, Entonces manda Authorization Bearer + el id y clientTxId correctos al endpoint real de PayPhone", async () => {
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ transactionStatus: "Approved", statusCode: 3, transactionId: 555, clientTransactionId: "rental-9", amount: 650 }),
    });
    (global as any).fetch = fetchSpy;

    await new PayphoneClient().confirm(555, "rental-9");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://paymentbox.payphonetodoesposible.com/api/confirm",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-token", "Content-Type": "application/json" }),
        body: JSON.stringify({ id: 555, clientTxId: "rental-9" }),
      })
    );
  });

  it("Dado un amount con decimales/negativo raro del proveedor, Cuando se confirma, Entonces amountCents refleja EXACTAMENTE lo que PayPhone mandó — este cliente no valida el monto, eso es responsabilidad del llamador (comparar contra expectedCents)", async () => {
    mockFetchResolved(200, { transactionStatus: "Approved", statusCode: 3, transactionId: 1, clientTransactionId: "rental-1", amount: -1 });

    const result = await new PayphoneClient().confirm(1, "rental-1");
    expect(result.amountCents).toBe(-1);
  });
});
