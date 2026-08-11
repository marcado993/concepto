import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { LogtoOidcClient } from "./logto-oidc.client";
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
  let prisma: { user: { upsert: jest.Mock } };
  let config: ConfigService;

  beforeEach(async () => {
    logto = {
      generatePkce: jest.fn().mockReturnValue({ codeVerifier: "verifier-1", codeChallenge: "challenge-1", state: "state-1" }),
      authorizationUrl: jest.fn().mockReturnValue("https://logto.example/oidc/auth?direct_sign_in=social:github"),
      exchangeCode: jest.fn(),
    };
    prisma = { user: { upsert: jest.fn().mockResolvedValue({ id: "user-1" }) } };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: LogtoOidcClient, useValue: logto },
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

  it("Dado un inicio de login, Cuando se llama /auth/login, Entonces guarda code_verifier+state en una cookie FIRMADA y HTTPOnly, y redirige a Logto con direct_sign_in=social:github", () => {
    const res = mockResponse();

    controller.login(res);

    expect(res.cookie).toHaveBeenCalledWith(
      "aeis_oidc_pending",
      expect.stringContaining("verifier-1"),
      expect.objectContaining({ httpOnly: true, signed: true, secure: true })
    );
    expect(logto.authorizationUrl).toHaveBeenCalledWith({ codeChallenge: "challenge-1", state: "state-1" });
    expect(res.redirect).toHaveBeenCalledWith("https://logto.example/oidc/auth?direct_sign_in=social:github");
  });

  it("Dado un callback sin cookie de PKCE pendiente (expirada o CSRF), Cuando se llama /auth/callback, Entonces rechaza con BadRequestException sin intentar intercambiar el código", async () => {
    const req = { signedCookies: {} } as any;
    const res = mockResponse();

    await expect(controller.callback("code-x", "state-x", req, res)).rejects.toBeInstanceOf(BadRequestException);
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

    await controller.callback("code-1", "state-1", req, res);

    expect(logto.exchangeCode).toHaveBeenCalledWith({
      code: "code-1",
      state: "state-1",
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
      claims: () => ({ sub: "github|42" }),
    });

    await controller.callback("code-2", "state-1", req, res);

    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {} })
    );
  });
});
