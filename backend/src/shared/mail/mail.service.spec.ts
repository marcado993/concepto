import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { MailService } from "./mail.service";

// Resend se mockea a nivel de módulo — no hay forma de instanciar
// MailService con un cliente Resend falso sin tocar código de producción
// (getClient() construye `new Resend(...)` internamente, a propósito
// perezoso — ver el comentario en mail.service.ts). jest.mock() intercepta
// el import antes de que MailService lo use.
const sendMock = jest.fn();
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

async function buildService(env: Record<string, string> = {}) {
  const config = {
    getOrThrow: (key: string) =>
      ({ RESEND_API_KEY: "re_test_key", MAIL_FROM: "contratos@correo.aeis.app", ...env })[key],
  };
  const moduleRef = await Test.createTestingModule({
    providers: [MailService, { provide: ConfigService, useValue: config }],
  }).compile();
  return moduleRef.get(MailService);
}

describe("MailService.send", () => {
  beforeEach(() => sendMock.mockReset());

  it("Dado un envío sin cc, Cuando se manda, Entonces NO incluye la clave cc en la llamada a Resend", async () => {
    sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
    const service = await buildService();

    await service.send({ to: "estudiante@epn.edu.ec", subject: "Asunto", html: "<p>hola</p>" });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "contratos@correo.aeis.app", to: "estudiante@epn.edu.ec" })
    );
    expect(sendMock.mock.calls[0][0]).not.toHaveProperty("cc");
  });

  it("Dado un envío CON cc, Cuando se manda, Entonces se la pasa a Resend tal cual", async () => {
    sendMock.mockResolvedValue({ data: { id: "email-2" }, error: null });
    const service = await buildService();

    await service.send({ to: "estudiante@epn.edu.ec", cc: "aeis.fis.epn@gmail.com", subject: "Asunto", html: "<p>hola</p>" });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ cc: "aeis.fis.epn@gmail.com" }));
  });

  it("Dado que Resend rechaza el envío, Cuando se manda, Entonces lanza un error SANITIZADO — nunca el detalle crudo de Resend hacia quien llamó", async () => {
    sendMock.mockResolvedValue({ data: null, error: { name: "validation_error", message: "detalle interno con datos sensibles" } });
    const service = await buildService();

    await expect(service.send({ to: "x@epn.edu.ec", subject: "s", html: "h" })).rejects.toThrow(/validation_error/);
    await expect(service.send({ to: "x@epn.edu.ec", subject: "s", html: "h" })).rejects.not.toThrow(/detalle interno con datos sensibles/);
  });
});
