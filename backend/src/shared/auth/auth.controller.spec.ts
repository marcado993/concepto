import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { LogtoOidcClient } from "./logto-oidc.client";
import { ExperienceApiError, LogtoExperienceClient } from "./logto-experience.client";
import { PrismaService } from "../prisma/prisma.service";
import { EmailDestinationLimiter } from "../rate-limit/email-destination-limiter.service";
import { EmailPendingTokenService } from "./email-pending-token.service";

function mockResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as any;
}

describe("AuthController", () => {
  let controller: AuthController;
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
  let config: ConfigService;

  beforeEach(async () => {
    logto = {
      generatePkce: jest.fn().mockReturnValue({ codeVerifier: "verifier-1", codeChallenge: "challenge-1", state: "state-1" }),
      authorizationUrl: jest.fn().mockReturnValue("https://logto.example/oidc/auth?direct_sign_in=social:github"),
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
      controllers: [AuthController],
      providers: [
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
        // Clases reales, no mocks — son en memoria y sin dependencias
        // externas, así que usarlas tal cual prueba el comportamiento real
        // (límite por correo destino, firma/verificación del estado
        // pendiente) en vez de fingir que existen.
        EmailDestinationLimiter,
        EmailPendingTokenService,
      ],
    }).compile();
    controller = moduleRef.get(AuthController);
    config = moduleRef.get(ConfigService);
  });

  it("Dado un inicio de login sin conector especificado, Cuando se llama /auth/login, Entonces guarda code_verifier+state en una cookie FIRMADA y HTTPOnly, y redirige a la pantalla de Logto (sin forzar un conector — Logto muestra GitHub y correo institucional)", () => {
    const res = mockResponse();

    controller.login(undefined, undefined, res);

    expect(res.cookie).toHaveBeenCalledWith(
      "aeis_oidc_pending",
      expect.stringContaining("verifier-1"),
      expect.objectContaining({ httpOnly: true, signed: true, secure: true })
    );
    expect(logto.authorizationUrl).toHaveBeenCalledWith({
      codeChallenge: "challenge-1",
      state: "state-1",
      directSignIn: undefined,
      loginHint: undefined,
    });
    expect(res.redirect).toHaveBeenCalledWith("https://logto.example/oidc/auth?direct_sign_in=social:github");
  });

  it("Dado ?connector=github (botón 'Continuar con GitHub' de Login.svelte), Cuando se llama /auth/login, Entonces pasa direct_sign_in=social:github para saltar el selector de Logto", () => {
    const res = mockResponse();

    controller.login("github", undefined, res);

    expect(logto.authorizationUrl).toHaveBeenCalledWith({
      codeChallenge: "challenge-1",
      state: "state-1",
      directSignIn: "social:github",
      loginHint: undefined,
    });
  });

  it("Dado un ?connector desconocido/no soportado, Cuando se llama /auth/login, Entonces lo ignora en vez de reenviarlo tal cual a Logto (un valor arbitrario no debe inyectar cualquier direct_sign_in)", () => {
    const res = mockResponse();

    controller.login("cualquier-cosa-inventada", undefined, res);

    expect(logto.authorizationUrl).toHaveBeenCalledWith({
      codeChallenge: "challenge-1",
      state: "state-1",
      directSignIn: undefined,
      loginHint: undefined,
    });
  });

  it("Dado ?email=estudiante@epn.edu.ec (formulario de correo institucional de Login.svelte), Cuando se llama /auth/login, Entonces lo pasa como loginHint para precargar el campo en Logto", () => {
    const res = mockResponse();

    controller.login(undefined, "estudiante@epn.edu.ec", res);

    expect(logto.authorizationUrl).toHaveBeenCalledWith({
      codeChallenge: "challenge-1",
      state: "state-1",
      directSignIn: undefined,
      loginHint: "estudiante@epn.edu.ec",
    });
  });

  it("Dado un ?email con forma inválida (no es un correo real), Cuando se llama /auth/login, Entonces lo descarta en vez de reenviarlo tal cual a la URL de autorización", () => {
    const res = mockResponse();

    controller.login(undefined, "no-es-un-correo", res);

    expect(logto.authorizationUrl).toHaveBeenCalledWith({
      codeChallenge: "challenge-1",
      state: "state-1",
      directSignIn: undefined,
      loginHint: undefined,
    });
  });

  it("Dado que Logto no está configurado (credenciales placeholder), Cuando se llama /auth/login, Entonces redirige al frontend con una señal clara en vez de tirar un 500 crudo", () => {
    const res = mockResponse();
    logto.authorizationUrl.mockImplementation(() => {
      throw new Error("Logto no está configurado o no respondió al arrancar el backend — revisa LOGTO_ISSUER");
    });

    controller.login(undefined, undefined, res);

    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/?auth_error=logto_not_configured");
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("Dado un callback sin cookie de PKCE pendiente (expirada o CSRF), Cuando se llama /auth/callback, Entonces rechaza con BadRequestException sin intentar intercambiar el código", async () => {
    const req = { signedCookies: {} } as any;
    const res = mockResponse();

    await expect(controller.callback("code-x", "state-x", "https://tenant.logto.app/oidc", req, res)).rejects.toBeInstanceOf(BadRequestException);
    expect(logto.exchangeCode).not.toHaveBeenCalled();
  });

  it("Dado un callback válido, Cuando Logto confirma el código, Entonces provisiona el usuario y redirige al frontend con el access_token en el FRAGMENTO de la URL (nunca en query string ni logueado)", async () => {
    const req = {
      signedCookies: { aeis_oidc_pending: JSON.stringify({ codeVerifier: "verifier-1", state: "state-1" }) },
    } as any;
    const res = mockResponse();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-123",
      claims: () => ({ sub: "github|42", email: "estudiante@epn.edu.ec", name: "Estudiante EPN" }),
    });

    await controller.callback("code-1", "state-1", "https://tenant.logto.app/oidc", req, res);

    expect(logto.exchangeCode).toHaveBeenCalledWith({
      code: "code-1",
      state: "state-1",
      iss: "https://tenant.logto.app/oidc",
      expectedState: "state-1",
      codeVerifier: "verifier-1",
    });
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { logtoSub: "github|42" } })
    );
    expect(res.clearCookie).toHaveBeenCalledWith("aeis_oidc_pending");
    expect(res.redirect).toHaveBeenCalledWith(
      "https://aeis-app.vercel.app/#access_token=at-123"
    );
  });

  it("Dado un usuario que ya existe (mismo logtoSub), Cuando vuelve a hacer login, Entonces NO sobreescribe su rol/código único ya asignados (upsert.update = {})", async () => {
    const req = {
      signedCookies: { aeis_oidc_pending: JSON.stringify({ codeVerifier: "verifier-1", state: "state-1" }) },
    } as any;
    const res = mockResponse();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-999",
      claims: () => ({ sub: "github|42", email: "estudiante@epn.edu.ec" }),
    });

    await controller.callback("code-2", "state-1", "https://tenant.logto.app/oidc", req, res);

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} })
    );
  });

  it("Dado un correo personal (no @epn.edu.ec), Cuando se llama /auth/callback, Entonces provisiona el usuario igual — decisión real de DGIP: ya no se exige dominio institucional (evita que graduarse/dar de baja la cuenta EPN deje al estudiante sin poder loguearse)", async () => {
    const req = {
      signedCookies: { aeis_oidc_pending: JSON.stringify({ codeVerifier: "verifier-1", state: "state-1" }) },
    } as any;
    const res = mockResponse();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-123",
      claims: () => ({ sub: "github|99", email: "cualquiera@gmail.com", name: "Estudiante" }),
    });

    await controller.callback("code-3", "state-1", "https://tenant.logto.app/oidc", req, res);

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { logtoSub: "github|99" } })
    );
    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/#access_token=at-123");
  });

  it("Dado un login de GitHub sin correo público/verificado (claims.email undefined), Cuando se llama /auth/callback, Entonces rechaza — sin ningún correo no hay forma de identificar/contactar al usuario, sin importar el dominio", async () => {
    const req = {
      signedCookies: { aeis_oidc_pending: JSON.stringify({ codeVerifier: "verifier-1", state: "state-1" }) },
    } as any;
    const res = mockResponse();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-123",
      claims: () => ({ sub: "github|100" }),
    });

    await controller.callback("code-4", "state-1", "https://tenant.logto.app/oidc", req, res);

    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      "https://aeis-app.vercel.app/?auth_error=correo_no_disponible"
    );
  });

  it("Dado un correo institucional con mayúsculas (EPN a veces manda EstudiantE@EPN.EDU.EC), Cuando se llama /auth/callback, Entonces lo acepta — la comparación de dominio no distingue mayúsculas/minúsculas", async () => {
    const req = {
      signedCookies: { aeis_oidc_pending: JSON.stringify({ codeVerifier: "verifier-1", state: "state-1" }) },
    } as any;
    const res = mockResponse();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-123",
      claims: () => ({ sub: "github|101", email: "Estudiante@EPN.EDU.EC" }),
    });

    await controller.callback("code-5", "state-1", "https://tenant.logto.app/oidc", req, res);

    expect(prisma.user.upsert).toHaveBeenCalled();
  });

  it("Dado un usuario autenticado, Cuando pide /auth/me, Entonces retorna nombre/código/rol/cédula/celular, nunca el logtoSub ni otros campos internos", async () => {
    const req = { user: { id: "user-1" } } as any;

    const result = await controller.me(req);

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        select: { fullName: true, uniqueCode: true, role: true, cedula: true, phone: true },
      })
    );
    expect(result).toEqual({
      fullName: "Estudiante EPN",
      uniqueCode: "PENDIENTE-abc",
      role: "ESTUDIANTE",
      cedula: null,
      phone: null,
    });
  });

  it("Dado un id de usuario que ya no existe en la base, Cuando pide /auth/me, Entonces lanza UnauthorizedException", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const req = { user: { id: "user-fantasma" } } as any;

    await expect(controller.me(req)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // Hallazgo real de producción: el conector de correo de Logto le pasa
  // por debajo a Resend, y Resend en modo sandbox rechaza mandar a
  // cualquiera que no sea el dueño de la cuenta con SU PROPIO mensaje de
  // error crudo (nombra el proveedor, el modo sandbox, y el correo
  // personal del dueño). Antes de este fix, ExperienceApiError.message se
  // reenviaba tal cual al cliente sin autenticar — cualquier visitante
  // veía ese mensaje interno. Estas pruebas fijan que NUNCA vuelva a pasar.
  it("Dado que Logto/Resend rechaza el envío del código con su mensaje interno crudo, Cuando se llama /auth/email/start, Entonces el cliente recibe un mensaje genérico — nunca el mensaje crudo del conector", async () => {
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
      await controller.emailStart("estudiante@epn.edu.ec", res);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as Error).message).not.toContain("dev@epn.edu.ec");
    expect((caught as Error).message).not.toContain("connector");
  });

  it("Dado que Logto/Resend rechaza el envío del código, Cuando se llama /auth/email/start, Entonces lanza BadRequestException con un mensaje seguro y NO setea la cookie de verificación pendiente", async () => {
    const res = mockResponse();
    logtoExperience.requestEmailCode.mockRejectedValue(
      new ExperienceApiError(422, "connector.general", "detalle interno del proveedor de correo")
    );

    await expect(controller.emailStart("estudiante@epn.edu.ec", res)).rejects.toThrow(
      "No se pudo enviar el código a tu correo — intenta de nuevo en unos minutos."
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  // Bug real reportado en producción: "Sesión de verificación expirada o
  // inválida" apenas se manda el código. Causa raíz: aeis.app (frontend) y
  // api.aeis-app.online (backend) son dominios DISTINTOS — el navegador
  // considera esto cross-site. Login.svelte habla con /auth/email/start y
  // /auth/email/verify por fetch() (no por navegación de página completa,
  // a diferencia del login con GitHub), y CUALQUIER cookie entre sitios
  // distintos es frágil: primero se intentó SameSite=None+Secure (en el
  // papel debía bastar) y en producción real SEGUÍA fallando — varios
  // navegadores bloquean cookies de terceros sin importar SameSite. El fix
  // real fue dejar de depender de que el navegador reenvíe una cookie:
  // ahora el estado pendiente viaja EXPLÍCITO en el cuerpo JSON
  // (pendingToken), igual que ya viaja el access_token final. Nunca se
  // detectó en local porque ahí frontend/backend corren en el mismo
  // origen o mismo sitio.
  it("Dado que /auth/email/start ya no usa cookies para el estado pendiente, Cuando se llama, Entonces devuelve un pendingToken explícito en el cuerpo JSON (nada de res.cookie)", async () => {
    const res = mockResponse();
    logtoExperience.requestEmailCode.mockResolvedValue({
      cookie: "_interaction=with-code",
      verificationId: "verif-1",
    });

    await controller.emailStart("estudiante@epn.edu.ec", res);

    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ pendingToken: expect.any(String) });
  });

  it("Dado un pendingToken válido y un código correcto, Cuando se llama /auth/email/verify, Entonces intercambia el token real sin depender de ninguna cookie", async () => {
    const startRes = mockResponse();
    logtoExperience.requestEmailCode.mockResolvedValue({
      cookie: "_interaction=with-code",
      verificationId: "verif-1",
    });
    await controller.emailStart("estudiante@epn.edu.ec", startRes);
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
    await controller.emailVerify("123456", pendingToken, verifyRes);

    expect(logtoExperience.verifyEmailCode).toHaveBeenCalledWith("_interaction=with-code", "estudiante@epn.edu.ec", "123456", "verif-1");
    expect(verifyRes.json).toHaveBeenCalledWith({ accessToken: "at-email-1" });
  });

  it("Dado un pendingToken ausente, vacío o alterado, Cuando se llama /auth/email/verify, Entonces rechaza con el mismo mensaje genérico — nunca intenta leer una cookie", async () => {
    const res = mockResponse();
    await expect(controller.emailVerify("123456", undefined, res)).rejects.toThrow(
      "Sesión de verificación expirada o inválida — solicita un nuevo código"
    );
    await expect(controller.emailVerify("123456", "token-inventado-a-mano", res)).rejects.toThrow(
      "Sesión de verificación expirada o inválida — solicita un nuevo código"
    );
    expect(logtoExperience.verifyEmailCode).not.toHaveBeenCalled();
  });

  it("Dado un correo nuevo (primera vez), Cuando /auth/email/verify recibe user.user_not_exist, Entonces reinicia como registro y devuelve un pendingToken NUEVO — el viejo ya no debe servir", async () => {
    const startRes = mockResponse();
    logtoExperience.requestEmailCode.mockResolvedValue({
      cookie: "_interaction=with-code",
      verificationId: "verif-1",
    });
    await controller.emailStart("nuevo@epn.edu.ec", startRes);
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
    await controller.emailVerify("123456", oldToken, verifyRes);

    expect(verifyRes.status).toHaveBeenCalledWith(202);
    const body = verifyRes.json.mock.calls[0][0];
    expect(body.needsNewCode).toBe(true);
    expect(body.pendingToken).toEqual(expect.any(String));
    expect(body.pendingToken).not.toBe(oldToken);
  });
});
