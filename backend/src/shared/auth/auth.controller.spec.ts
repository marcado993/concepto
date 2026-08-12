import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { LogtoOidcClient } from "./logto-oidc.client";
import { LogtoExperienceClient } from "./logto-experience.client";
import { PrismaService } from "../prisma/prisma.service";

function mockResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
  } as any;
}

describe("AuthController", () => {
  let controller: AuthController;
  let logto: { generatePkce: jest.Mock; authorizationUrl: jest.Mock; exchangeCode: jest.Mock };
  let prisma: { user: { upsert: jest.Mock; findUnique: jest.Mock } };
  let config: ConfigService;

  beforeEach(async () => {
    logto = {
      generatePkce: jest.fn().mockReturnValue({ codeVerifier: "verifier-1", codeChallenge: "challenge-1", state: "state-1" }),
      authorizationUrl: jest.fn().mockReturnValue("https://logto.example/oidc/auth?direct_sign_in=social:github"),
      exchangeCode: jest.fn(),
    };
    prisma = {
      user: {
        upsert: jest.fn().mockResolvedValue({ id: "user-1" }),
        findUnique: jest.fn().mockResolvedValue({ fullName: "Estudiante EPN", uniqueCode: "PENDIENTE-abc", role: "ESTUDIANTE" }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: LogtoOidcClient, useValue: logto },
        { provide: LogtoExperienceClient, useValue: {} },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) =>
              ({ FRONTEND_ORIGIN: "https://aeis-app.vercel.app", LOGTO_ISSUER: "https://tenant.logto.app/oidc" })[key],
          },
        },
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

  it("Dado un correo que NO es @epn.edu.ec, Cuando se llama /auth/callback, Entonces rechaza SIN crear el usuario ni emitir token — la autenticación con Logto fue real, pero este backend no lo trata como estudiante de la EPN", async () => {
    const req = {
      signedCookies: { aeis_oidc_pending: JSON.stringify({ codeVerifier: "verifier-1", state: "state-1" }) },
    } as any;
    const res = mockResponse();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-123",
      claims: () => ({ sub: "github|99", email: "cualquiera@gmail.com", name: "No EPN" }),
    });

    await controller.callback("code-3", "state-1", "https://tenant.logto.app/oidc", req, res);

    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      "https://aeis-app.vercel.app/?auth_error=dominio_no_institucional"
    );
  });

  it("Dado un login de GitHub sin correo público/verificado (claims.email undefined), Cuando se llama /auth/callback, Entonces rechaza igual — sin correo no hay forma de verificar el dominio", async () => {
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
      "https://aeis-app.vercel.app/?auth_error=dominio_no_institucional"
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

  it("Dado un usuario autenticado, Cuando pide /auth/me, Entonces retorna solo nombre/código/rol, nunca el logtoSub ni otros campos internos", async () => {
    const req = { user: { id: "user-1" } } as any;

    const result = await controller.me(req);

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" }, select: { fullName: true, uniqueCode: true, role: true } })
    );
    expect(result).toEqual({ fullName: "Estudiante EPN", uniqueCode: "PENDIENTE-abc", role: "ESTUDIANTE" });
  });

  it("Dado un id de usuario que ya no existe en la base, Cuando pide /auth/me, Entonces lanza UnauthorizedException", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const req = { user: { id: "user-fantasma" } } as any;

    await expect(controller.me(req)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
