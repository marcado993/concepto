import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";
import { OidcRedirectStrategy } from "./oidc-redirect.strategy";
import { LogtoOidcClient } from "../logto-oidc.client";
import { AuthService } from "../auth.service";
import { PrismaService } from "../../prisma/prisma.service";

function mockResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as any;
}

describe("OidcRedirectStrategy", () => {
  let strategy: OidcRedirectStrategy;
  let logto: { generatePkce: jest.Mock; authorizationUrl: jest.Mock; exchangeCode: jest.Mock };
  let prisma: { user: { upsert: jest.Mock; findUnique: jest.Mock } };

  beforeEach(async () => {
    logto = {
      generatePkce: jest.fn().mockReturnValue({ codeVerifier: "verifier-1", codeChallenge: "challenge-1", state: "state-1" }),
      authorizationUrl: jest.fn().mockReturnValue("https://logto.example/oidc/auth?direct_sign_in=social:github"),
      exchangeCode: jest.fn(),
    };
    prisma = {
      user: {
        upsert: jest.fn().mockResolvedValue({ id: "user-1" }),
        findUnique: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OidcRedirectStrategy,
        AuthService,
        { provide: LogtoOidcClient, useValue: logto },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) =>
              ({
                FRONTEND_ORIGIN: "https://aeis-app.vercel.app",
                LOGTO_ISSUER: "https://tenant.logto.app/oidc",
              })[key],
          },
        },
      ],
    }).compile();
    strategy = moduleRef.get(OidcRedirectStrategy);
  });

  it("Dado un inicio de login sin conector especificado, Cuando se llama start(), Entonces guarda code_verifier+state en una cookie FIRMADA y HTTPOnly, y redirige a la pantalla de Logto (sin forzar un conector — Logto muestra GitHub y correo institucional)", () => {
    const res = mockResponse();

    strategy.start(undefined, undefined, res);

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

  it("Dado ?connector=github, Cuando se llama start(), Entonces pasa direct_sign_in=social:github para saltar el selector de Logto", () => {
    const res = mockResponse();

    strategy.start("github", undefined, res);

    expect(logto.authorizationUrl).toHaveBeenCalledWith({
      codeChallenge: "challenge-1",
      state: "state-1",
      directSignIn: "social:github",
      loginHint: undefined,
    });
  });

  it("Dado ?connector=google, Cuando se llama start(), Entonces pasa direct_sign_in=social:google para saltar el selector de Logto", () => {
    const res = mockResponse();

    strategy.start("google", undefined, res);

    expect(logto.authorizationUrl).toHaveBeenCalledWith({
      codeChallenge: "challenge-1",
      state: "state-1",
      directSignIn: "social:google",
      loginHint: undefined,
    });
  });

  it("Dado un connector desconocido/no soportado, Cuando se llama start(), Entonces lo ignora (un valor arbitrario no debe inyectar cualquier direct_sign_in)", () => {
    const res = mockResponse();

    strategy.start("cualquier-cosa-inventada", undefined, res);

    expect(logto.authorizationUrl).toHaveBeenCalledWith({
      codeChallenge: "challenge-1",
      state: "state-1",
      directSignIn: undefined,
      loginHint: undefined,
    });
  });

  it("Dado ?email=estudiante@epn.edu.ec, Cuando se llama start(), Entonces lo pasa como loginHint para precargar el campo en Logto", () => {
    const res = mockResponse();

    strategy.start(undefined, "estudiante@epn.edu.ec", res);

    expect(logto.authorizationUrl).toHaveBeenCalledWith({
      codeChallenge: "challenge-1",
      state: "state-1",
      directSignIn: undefined,
      loginHint: "estudiante@epn.edu.ec",
    });
  });

  it("Dado un ?email con forma inválida, Cuando se llama start(), Entonces lo descarta en vez de reenviarlo tal cual a la URL de autorización", () => {
    const res = mockResponse();

    strategy.start(undefined, "no-es-un-correo", res);

    expect(logto.authorizationUrl).toHaveBeenCalledWith({
      codeChallenge: "challenge-1",
      state: "state-1",
      directSignIn: undefined,
      loginHint: undefined,
    });
  });

  it("Dado que Logto no está configurado (credenciales placeholder), Cuando se llama start(), Entonces redirige al frontend con auth_error=logto_not_configured en vez de tirar un 500", () => {
    const res = mockResponse();
    logto.authorizationUrl.mockImplementation(() => {
      throw new Error("Logto no está configurado o no respondió al arrancar el backend — revisa LOGTO_ISSUER");
    });

    strategy.start(undefined, undefined, res);

    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/?auth_error=logto_not_configured");
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("Dado un callback sin cookie de PKCE pendiente (expirada o CSRF), Cuando se llama callback(), Entonces rechaza con BadRequestException sin intentar intercambiar el código", async () => {
    const req = { signedCookies: {} } as any;
    const res = mockResponse();

    await expect(strategy.callback("code-x", "state-x", "https://tenant.logto.app/oidc", req, res)).rejects.toBeInstanceOf(BadRequestException);
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

    await strategy.callback("code-1", "state-1", "https://tenant.logto.app/oidc", req, res);

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
    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/#access_token=at-123");
  });

  it("Dado un usuario que ya existe (mismo logtoSub), Cuando vuelve a hacer login, Entonces NO sobreescribe su rol/código único ya asignados (upsert.update solo toca el correo)", async () => {
    const req = {
      signedCookies: { aeis_oidc_pending: JSON.stringify({ codeVerifier: "verifier-1", state: "state-1" }) },
    } as any;
    const res = mockResponse();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-999",
      claims: () => ({ sub: "github|42", email: "estudiante@epn.edu.ec" }),
    });

    await strategy.callback("code-2", "state-1", "https://tenant.logto.app/oidc", req, res);

    const upsertArgs = prisma.user.upsert.mock.calls[0][0];
    expect(upsertArgs.update).toEqual({ email: "estudiante@epn.edu.ec" });
    expect(upsertArgs.update).not.toHaveProperty("role");
    expect(upsertArgs.update).not.toHaveProperty("uniqueCode");
  });

  it("Dado un correo personal (no @epn.edu.ec), Cuando se llama callback(), Entonces provisiona el usuario igual — decisión de DGIP: ya no se exige dominio institucional", async () => {
    const req = {
      signedCookies: { aeis_oidc_pending: JSON.stringify({ codeVerifier: "verifier-1", state: "state-1" }) },
    } as any;
    const res = mockResponse();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-123",
      claims: () => ({ sub: "github|99", email: "cualquiera@gmail.com", name: "Estudiante" }),
    });

    await strategy.callback("code-3", "state-1", "https://tenant.logto.app/oidc", req, res);

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { logtoSub: "github|99" } })
    );
    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/#access_token=at-123");
  });

  it("Dado un login sin correo público/verificado (claims.email undefined), Cuando se llama callback(), Entonces rechaza — sin correo no hay forma de identificar al usuario", async () => {
    const req = {
      signedCookies: { aeis_oidc_pending: JSON.stringify({ codeVerifier: "verifier-1", state: "state-1" }) },
    } as any;
    const res = mockResponse();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-123",
      claims: () => ({ sub: "github|100" }),
    });

    await strategy.callback("code-4", "state-1", "https://tenant.logto.app/oidc", req, res);

    expect(prisma.user.upsert).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith("https://aeis-app.vercel.app/?auth_error=correo_no_disponible");
  });

  it("Dado un correo institucional con mayúsculas (EPN a veces manda EstudiantE@EPN.EDU.EC), Cuando se llama callback(), Entonces lo acepta — la comparación de dominio no distingue mayúsculas/minúsculas", async () => {
    const req = {
      signedCookies: { aeis_oidc_pending: JSON.stringify({ codeVerifier: "verifier-1", state: "state-1" }) },
    } as any;
    const res = mockResponse();
    logto.exchangeCode.mockResolvedValue({
      access_token: "at-123",
      claims: () => ({ sub: "github|101", email: "Estudiante@EPN.EDU.EC" }),
    });

    await strategy.callback("code-5", "state-1", "https://tenant.logto.app/oidc", req, res);

    expect(prisma.user.upsert).toHaveBeenCalled();
  });
});
