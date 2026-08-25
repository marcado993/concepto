import { AuthService, isValidEmail } from "./auth.service";

function makeService() {
  const logto = { exchangeCode: jest.fn() };
  const prisma = { user: { upsert: jest.fn().mockResolvedValue({ id: "user-1" }) } };
  const service = new AuthService(logto as any, prisma as any);
  return { service, logto, prisma };
}

describe("isValidEmail", () => {
  it("Dado un correo con forma válida de cualquier dominio, Cuando se valida, Entonces lo acepta — ya no se exige @epn.edu.ec", () => {
    expect(isValidEmail("estudiante@epn.edu.ec")).toBe(true);
    expect(isValidEmail("cualquiera@gmail.com")).toBe(true);
  });

  it("Dado un correo con forma inválida o ausente, Cuando se valida, Entonces lo rechaza", () => {
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("no-es-un-correo")).toBe(false);
    expect(isValidEmail("@sin-usuario.com")).toBe(false);
  });
});

// Cobertura directa de AuthService, sin pasar por HTTP/cookies — la misma
// lógica ya se ejerce indirectamente desde auth.controller.spec.ts
// (callback/emailVerify), pero probarla aislada confirma que de verdad no
// depende de Express en absoluto (Injectable puro: logto + prisma), que
// era el punto de sacarla del controlador.
describe("AuthService.finishTokenExchange", () => {
  it("Dado un intercambio con correo válido, Cuando se completa, Entonces provisiona el usuario y devuelve el access_token", async () => {
    const { service, logto, prisma } = makeService();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-1",
      claims: () => ({ sub: "github|1", email: "estudiante@epn.edu.ec", name: "Estudiante EPN" }),
    });

    const result = await service.finishTokenExchange({
      code: "code-1",
      state: "state-1",
      expectedState: "state-1",
      codeVerifier: "verifier-1",
    });

    expect(result).toEqual({ ok: true, accessToken: "at-1" });
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { logtoSub: "github|1" },
        // update rellena el correo (lo necesita /auth/email/start para
        // acertar el evento de Logto a la primera — ver schema.prisma).
        update: { email: "estudiante@epn.edu.ec" },
        create: expect.objectContaining({
          logtoSub: "github|1",
          fullName: "Estudiante EPN",
          email: "estudiante@epn.edu.ec",
        }),
      })
    );
  });

  it("Dado un usuario que ya existe (mismo logtoSub), Cuando se reintercambia, Entonces NO sobreescribe su rol/código único — solo pone al día el correo", async () => {
    const { service, logto, prisma } = makeService();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-2",
      claims: () => ({ sub: "github|1", email: "estudiante@epn.edu.ec" }),
    });

    await service.finishTokenExchange({ code: "c", state: "s", expectedState: "s", codeVerifier: "v" });

    const args = prisma.user.upsert.mock.calls[0][0];
    expect(args.update).toEqual({ email: "estudiante@epn.edu.ec" });
    expect(args.update).not.toHaveProperty("role");
    expect(args.update).not.toHaveProperty("uniqueCode");
  });

  // Bug real reportado: el login por correo (OTP) no trae ningún claim
  // `name` — antes el fallback usaba el CORREO como fullName, así que el
  // "nombre completo" de medio estudiante era literalmente su dirección
  // de correo (visible en /auth/me, en el formulario de alquiler, y a
  // punto de salir firmando el contrato).
  it("Dado un intercambio SIN claim de nombre (típico del login por correo/OTP), Cuando se provisiona, Entonces usa el placeholder reconocible — NUNCA el correo como nombre", async () => {
    const { service, logto, prisma } = makeService();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-4",
      claims: () => ({ sub: "logto|otp-1", email: "estudiante@epn.edu.ec" }),
    });

    await service.finishTokenExchange({ code: "c", state: "s", expectedState: "s", codeVerifier: "v" });

    const args = prisma.user.upsert.mock.calls[0][0];
    expect(args.create.fullName).not.toBe("estudiante@epn.edu.ec");
    expect(args.create.fullName).toBe("Estudiante pendiente de completar registro");
  });

  it("Dado un token sin claim de correo (GitHub sin correo público/verificado), Cuando se completa, Entonces rechaza SIN tocar la base de datos — nunca un User a medias", async () => {
    const { service, logto, prisma } = makeService();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-3",
      claims: () => ({ sub: "github|2" }),
    });

    const result = await service.finishTokenExchange({ code: "c", state: "s", expectedState: "s", codeVerifier: "v" });

    expect(result).toEqual({ ok: false, reason: "correo_no_disponible" });
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("Dado que Logto no devuelve access_token, Cuando se completa, Entonces lanza en vez de silenciar el fallo", async () => {
    const { service, logto } = makeService();
    logto.exchangeCode.mockResolvedValue({
      access_token: undefined,
      claims: () => ({ sub: "github|3", email: "estudiante@epn.edu.ec" }),
    });

    await expect(
      service.finishTokenExchange({ code: "c", state: "s", expectedState: "s", codeVerifier: "v" })
    ).rejects.toThrow("Logto no devolvió access_token");
  });
});
