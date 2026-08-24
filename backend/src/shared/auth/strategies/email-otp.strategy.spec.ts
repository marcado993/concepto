import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";
import { ExperienceApiError, LogtoExperienceClient } from "../logto-experience.client";
import { EmailOtpStrategy } from "./email-otp.strategy";
import { LogtoOidcClient } from "../logto-oidc.client";
import { PrismaService } from "../../prisma/prisma.service";
import { EmailDestinationLimiter } from "../../rate-limit/email-destination-limiter.service";
import { EmailPendingTokenService } from "../email-pending-token.service";
import { AuthService } from "../auth.service";

function mockResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as any;
}

describe("EmailOtpStrategy", () => {
  let strategy: EmailOtpStrategy;
  let logto: { generatePkce: jest.Mock; authorizationUrl: jest.Mock; exchangeCode: jest.Mock };
  let logtoExperience: {
    startInteraction: jest.Mock;
    setInteractionEvent: jest.Mock;
    requestEmailCode: jest.Mock;
    verifyEmailCode: jest.Mock;
    submitIdentification: jest.Mock;
    submitInteraction: jest.Mock;
    completeAuthorization: jest.Mock;
  };
  let prisma: { user: { upsert: jest.Mock; findUnique: jest.Mock } };

  beforeEach(async () => {
    logto = {
      generatePkce: jest.fn().mockReturnValue({ codeVerifier: "verifier-1", codeChallenge: "challenge-1", state: "state-1" }),
      authorizationUrl: jest.fn().mockReturnValue("https://logto.example/oidc/auth"),
      exchangeCode: jest.fn(),
    };
    logtoExperience = {
      startInteraction: jest.fn().mockResolvedValue("_interaction=cookie-1"),
      setInteractionEvent: jest.fn().mockResolvedValue("_interaction=cookie-2"),
      requestEmailCode: jest.fn(),
      verifyEmailCode: jest.fn(),
      submitIdentification: jest.fn(),
      submitInteraction: jest.fn(),
      completeAuthorization: jest.fn(),
    };
    prisma = {
      user: {
        upsert: jest.fn().mockResolvedValue({ id: "user-1" }),
        findUnique: jest.fn().mockResolvedValue({
          fullName: "Estudiante EPN",
          uniqueCode: "PENDIENTE-abc",
          role: "ESTUDIANTE",
          cedula: null,
          phone: null,
        }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailOtpStrategy,
        AuthService,
        EmailDestinationLimiter,
        EmailPendingTokenService,
        { provide: LogtoOidcClient, useValue: logto },
        { provide: LogtoExperienceClient, useValue: logtoExperience },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) =>
              ({
                FRONTEND_ORIGIN: "https://aeis-app.vercel.app",
                LOGTO_ISSUER: "https://tenant.logto.app/oidc",
                COOKIE_SECRET: "test-secret",
              })[key],
          },
        },
      ],
    }).compile();
    strategy = moduleRef.get(EmailOtpStrategy);
  });

  // Hallazgo real de producción: el conector de correo de Logto le pasa
  // por debajo a Resend, y Resend en modo sandbox rechaza mandar a
  // cualquiera que no sea el dueño de la cuenta con SU PROPIO mensaje de
  // error crudo (nombra el proveedor, el modo sandbox, y el correo
  // personal del dueño). Antes de este fix, ExperienceApiError.message se
  // reenviaba tal cual al cliente sin autenticar — cualquier visitante
  // veía ese mensaje interno. Estas pruebas fijan que NUNCA vuelva a pasar.
  it("Dado que Logto/Resend rechaza el envío del código con su mensaje interno crudo, Cuando se llama start(), Entonces el cliente recibe un mensaje genérico — nunca el mensaje crudo del conector", async () => {
    const res = mockResponse();
    logtoExperience.requestEmailCode.mockRejectedValue(
      new ExperienceApiError(
        422,
        "connector.general",
        'Error occurred in connector: {"message":"Message failed: 550 You can only send testing emails to your own email address (dev@epn.edu.ec)."}'
      )
    );

    let caught: unknown;
    try {
      await strategy.start("estudiante@epn.edu.ec", res);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as Error).message).not.toContain("dev@epn.edu.ec");
    expect((caught as Error).message).not.toContain("connector");
  });

  it("Dado que Logto/Resend rechaza el envío del código, Cuando se llama start(), Entonces lanza BadRequestException con un mensaje seguro y NO llama a res.cookie()", async () => {
    const res = mockResponse();
    logtoExperience.requestEmailCode.mockRejectedValue(
      new ExperienceApiError(422, "connector.general", "detalle interno del proveedor de correo")
    );

    await expect(strategy.start("estudiante@epn.edu.ec", res)).rejects.toThrow(
      "No se pudo enviar el código a tu correo — intenta de nuevo en unos minutos."
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  // Bug real reportado en producción: "Sesión de verificación expirada o
  // inválida" apenas se manda el código. Causa raíz: aeis.app y
  // api.aeis-app.online son dominios DISTINTOS — el navegador considera
  // esto cross-site. El fix real fue dejar de depender de que el navegador
  // reenvíe una cookie: ahora el estado pendiente viaja EXPLÍCITO en el
  // cuerpo JSON (pendingToken).
  it("Dado que start() ya no usa cookies para el estado pendiente, Cuando se llama, Entonces devuelve un pendingToken explícito en el cuerpo JSON (nada de res.cookie)", async () => {
    const res = mockResponse();
    logtoExperience.requestEmailCode.mockResolvedValue({
      cookie: "_interaction=with-code",
      verificationId: "verif-1",
    });

    await strategy.start("estudiante@epn.edu.ec", res);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ pendingToken: expect.any(String) });
  });

  it("Dado un pendingToken válido y un código correcto, Cuando se llama verify(), Entonces intercambia el token real sin depender de ninguna cookie", async () => {
    const startRes = mockResponse();
    logtoExperience.requestEmailCode.mockResolvedValue({
      cookie: "_interaction=with-code",
      verificationId: "verif-1",
    });
    await strategy.start("estudiante@epn.edu.ec", startRes);
    const { pendingToken } = startRes.json.mock.calls[0][0];

    logtoExperience.verifyEmailCode.mockResolvedValue("_interaction=verified");
    logtoExperience.submitIdentification.mockResolvedValue({ status: 204, cookie: "_interaction=identified" });
    logtoExperience.submitInteraction.mockResolvedValue({ cookie: "_interaction=submitted", redirectTo: "https://tenant.logto.app/callback" });
    logtoExperience.completeAuthorization.mockResolvedValue({ code: "auth-code-1", state: "state-1", iss: undefined });
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-email-1",
      claims: () => ({ sub: "email|estudiante", email: "estudiante@epn.edu.ec", name: "Estudiante EPN" }),
    });

    const verifyRes = mockResponse();
    await strategy.verify("123456", pendingToken, verifyRes);

    expect(logtoExperience.verifyEmailCode).toHaveBeenCalledWith("_interaction=with-code", "estudiante@epn.edu.ec", "123456", "verif-1");
    expect(verifyRes.json).toHaveBeenCalledWith({ accessToken: "at-email-1" });
  });

  // Bug real reportado en producción: Logto distingue "el código venció o
  // ya se usó" (verification_code.not_found) de "el código está mal
  // escrito" (verification_code.code_mismatch), pero ambos caían en el
  // mismo "No se pudo verificar el código — intenta de nuevo" genérico.
  it("Dado que Logto dice que el código YA VENCIÓ O YA SE USÓ (verification_code.not_found), Cuando se llama verify(), Entonces el mensaje dice eso — no un genérico 'intenta de nuevo'", async () => {
    const startRes = mockResponse();
    logtoExperience.requestEmailCode.mockResolvedValue({ cookie: "_interaction=with-code", verificationId: "verif-1" });
    await strategy.start("estudiante@epn.edu.ec", startRes);
    const { pendingToken } = startRes.json.mock.calls[0][0];

    logtoExperience.verifyEmailCode.mockRejectedValue(
      new ExperienceApiError(400, "verification_code.not_found", "Verification code not found. Please send verification code first.")
    );

    const verifyRes = mockResponse();
    let caught: unknown;
    try {
      await strategy.verify("123456", pendingToken, verifyRes);
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toContain("venció o ya se usó");
  });

  it("Dado que Logto dice que el código está MAL ESCRITO (verification_code.code_mismatch), Cuando se llama verify(), Entonces el mensaje invita a revisar los dígitos, no a pedir uno nuevo", async () => {
    const startRes = mockResponse();
    logtoExperience.requestEmailCode.mockResolvedValue({ cookie: "_interaction=with-code", verificationId: "verif-1" });
    await strategy.start("estudiante@epn.edu.ec", startRes);
    const { pendingToken } = startRes.json.mock.calls[0][0];

    logtoExperience.verifyEmailCode.mockRejectedValue(
      new ExperienceApiError(400, "verification_code.code_mismatch", "Invalid verification code.")
    );

    const verifyRes = mockResponse();
    let caught: unknown;
    try {
      await strategy.verify("123456", pendingToken, verifyRes);
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toContain("Código incorrecto");
    expect((caught as Error).message).not.toContain("venció");
  });

  it("Dado un pendingToken ausente, vacío o alterado, Cuando se llama verify(), Entonces rechaza con el mismo mensaje genérico — nunca intenta leer una cookie", async () => {
    const res = mockResponse();
    await expect(strategy.verify("123456", undefined, res)).rejects.toThrow(
      "Sesión de verificación expirada o inválida — solicita un nuevo código"
    );
    await expect(strategy.verify("123456", "token-inventado-a-mano", res)).rejects.toThrow(
      "Sesión de verificación expirada o inválida — solicita un nuevo código"
    );
    expect(logtoExperience.verifyEmailCode).not.toHaveBeenCalled();
  });

  // Bug real reportado con captura: quien entraba por PRIMERA VEZ recibía
  // DOS correos con códigos distintos. Contrato real de Logto, comprobado
  // contra el tenant (agosto 2026):
  //   SignIn   → existente 204 · nuevo 404 user_not_exist
  //   Register → nuevo 201    · existente 422 email_already_in_use
  // y cambiar el evento a mitad DESTRUYE la verificación aprobada. Así que
  // hay que acertar el evento ANTES de mandar el código: lo decide
  // User.email de nuestra propia base.
  it("Dado un correo que NO está en nuestra base, Cuando se pide el código, Entonces la interacción arranca como Register — para que el registro salga con UN solo correo", async () => {
    prisma.user.findUnique.mockResolvedValue(null); // desconocido
    logtoExperience.requestEmailCode.mockResolvedValue({ cookie: "_interaction=with-code", verificationId: "verif-1" });

    await strategy.start("nuevo@epn.edu.ec", mockResponse());

    expect(logtoExperience.setInteractionEvent).toHaveBeenCalledWith(expect.any(String), "Register");
    expect(logtoExperience.requestEmailCode).toHaveBeenCalledWith(expect.any(String), "nuevo@epn.edu.ec", "Register");
  });

  it("Dado un correo que YA está en nuestra base, Cuando se pide el código, Entonces arranca como SignIn", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "viejo@epn.edu.ec" });
    logtoExperience.requestEmailCode.mockResolvedValue({ cookie: "_interaction=with-code", verificationId: "verif-1" });

    await strategy.start("viejo@epn.edu.ec", mockResponse());

    expect(logtoExperience.setInteractionEvent).toHaveBeenCalledWith(expect.any(String), "SignIn");
    expect(logtoExperience.requestEmailCode).toHaveBeenCalledWith(expect.any(String), "viejo@epn.edu.ec", "SignIn");
  });

  it("Dado un registro nuevo, Cuando Logto responde 201 (cuenta creada), Entonces se trata como éxito y el estudiante entra de una — un solo correo, sin segundo paso", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const startRes = mockResponse();
    logtoExperience.requestEmailCode.mockResolvedValue({ cookie: "_interaction=with-code", verificationId: "verif-1" });
    await strategy.start("nuevo@epn.edu.ec", startRes);
    const { pendingToken } = startRes.json.mock.calls[0][0];
    logtoExperience.requestEmailCode.mockClear();

    logtoExperience.verifyEmailCode.mockResolvedValue("_interaction=verified");
    // 201 = Created. Antes solo se aceptaba 204, así que un registro
    // EXITOSO se leía como error y terminaba pidiendo otro código.
    logtoExperience.submitIdentification.mockResolvedValue({ status: 201, cookie: "_interaction=registered" });
    logtoExperience.submitInteraction.mockResolvedValue({
      cookie: "_interaction=submitted",
      redirectTo: "https://tenant.logto.app/callback",
    });
    logtoExperience.completeAuthorization.mockResolvedValue({ code: "auth-1", state: "state-1", iss: undefined });
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-nuevo",
      claims: () => ({ sub: "email|nuevo", email: "nuevo@epn.edu.ec" }),
    });

    const verifyRes = mockResponse();
    await strategy.verify("123456", pendingToken, verifyRes);

    expect(logtoExperience.requestEmailCode).not.toHaveBeenCalled(); // ni un segundo correo
    expect(verifyRes.json).toHaveBeenCalledWith({ accessToken: "at-nuevo" });
    expect(verifyRes.status).not.toHaveBeenCalledWith(202);
  });

  // Red de seguridad: nuestra tabla dice que el correo existe (arranca como
  // SignIn) pero en Logto no está — pasa con cuentas creadas antes de que
  // existiera User.email. Como cambiar el evento destruye la verificación,
  // no queda otra que reiniciar y mandar un código nuevo. Es el ÚNICO caso
  // que sigue gastando dos correos, y se corrige solo: tras entrar, el
  // correo queda guardado y la próxima vez acierta a la primera.
  it("Dado que nuestra base está desincronizada con Logto, Cuando la identificación falla, Entonces reinicia con el evento correcto y avisa (202) — sin romper el login", async () => {
    const startRes = mockResponse();
    logtoExperience.requestEmailCode.mockResolvedValue({
      cookie: "_interaction=with-code",
      verificationId: "verif-1",
    });
    await strategy.start("nuevo@epn.edu.ec", startRes);
    const { pendingToken: oldToken } = startRes.json.mock.calls[0][0];

    logtoExperience.verifyEmailCode.mockResolvedValue("_interaction=verified");
    logtoExperience.submitIdentification.mockResolvedValue({
      status: 422,
      errorCode: "user.user_not_exist",
      cookie: "_interaction=identified",
    });
    logtoExperience.requestEmailCode.mockResolvedValue({
      cookie: "_interaction=with-code-register",
      verificationId: "verif-2",
    });

    const verifyRes = mockResponse();
    await strategy.verify("123456", oldToken, verifyRes);

    expect(verifyRes.status).toHaveBeenCalledWith(202);
    const body = verifyRes.json.mock.calls[0][0];
    expect(body.needsNewCode).toBe(true);
    expect(body.pendingToken).toEqual(expect.any(String));
    expect(body.pendingToken).not.toBe(oldToken);
  });
});
