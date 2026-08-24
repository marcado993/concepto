import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { OidcRedirectStrategy } from "./strategies/oidc-redirect.strategy";
import { SocialEmbeddedStrategy } from "./strategies/social-embedded.strategy";
import { EmailOtpStrategy } from "./strategies/email-otp.strategy";
import { PrismaService } from "../prisma/prisma.service";

// El controller ya no tiene lógica de login — solo enruta al delegado
// correspondiente. Los tests de cada flujo viven en el spec de su estrategia:
//   strategies/oidc-redirect.strategy.spec.ts
//   strategies/social-embedded.strategy.spec.ts
//   strategies/email-otp.strategy.spec.ts
//
// Acá solo se prueban los dos endpoints que SÍ viven en el controller:
// /auth/me y /auth/logout.

describe("AuthController", () => {
  let controller: AuthController;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      user: {
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
        // Las estrategias se mockean completas — no importan sus detalles
        // internos para probar el routing del controller.
        { provide: OidcRedirectStrategy, useValue: { start: jest.fn(), callback: jest.fn() } },
        { provide: SocialEmbeddedStrategy, useValue: { start: jest.fn(), callback: jest.fn() } },
        { provide: EmailOtpStrategy, useValue: { start: jest.fn(), verify: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) =>
              ({
                FRONTEND_ORIGIN: "https://aeis-app.vercel.app",
                LOGTO_ISSUER: "https://tenant.logto.app/oidc",
                LOGTO_APP_ID: "app-id-test",
              })[key],
          },
        },
      ],
    }).compile();
    controller = moduleRef.get(AuthController);
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

  it("Dado un usuario que hace logout, Cuando se llama /auth/logout, Entonces redirige al end_session de Logto con client_id y post_logout_redirect_uri (hallazgo real: sin client_id Logto muestra su propia pantalla genérica en vez de volver al frontend)", () => {
    const res = { redirect: jest.fn() } as any;

    controller.logout(res);

    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining("https://tenant.logto.app/oidc/session/end")
    );
    const redirectUrl = (res.redirect as jest.Mock).mock.calls[0][0] as string;
    const params = new URLSearchParams(new URL(redirectUrl).search);
    expect(params.get("client_id")).toBe("app-id-test");
    expect(params.get("post_logout_redirect_uri")).toBe("https://aeis-app.vercel.app");
  });
});
