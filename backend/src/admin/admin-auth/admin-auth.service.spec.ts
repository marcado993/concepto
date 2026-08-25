import { Test } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { AdminAuthService } from "./admin-auth.service";
import { PrismaService } from "../../shared/prisma/prisma.service";

async function buildService(overrides: { prisma?: any; jwt?: any } = {}) {
  const prisma = overrides.prisma ?? { adminAccount: { findUnique: jest.fn() } };
  const jwt = overrides.jwt ?? { signAsync: jest.fn().mockResolvedValue("signed.jwt.token") };

  const moduleRef = await Test.createTestingModule({
    providers: [
      AdminAuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: JwtService, useValue: jwt },
    ],
  }).compile();

  return { service: moduleRef.get(AdminAuthService), prisma, jwt };
}

describe("AdminAuthService.login", () => {
  it("Dada una cuenta real con la contraseña correcta, Cuando inicia sesión, Entonces firma un JWT con sub/email/role de ESA cuenta", async () => {
    const passwordHash = await bcrypt.hash("correcta123", 10);
    const { service, prisma, jwt } = await buildService({
      prisma: {
        adminAccount: {
          findUnique: jest.fn().mockResolvedValue({ id: "admin-1", email: "presidenta@aeis.app", passwordHash, role: "PRESIDENTE" }),
        },
      },
    });

    const result = await service.login("presidenta@aeis.app", "correcta123");

    expect(result).toEqual({ accessToken: "signed.jwt.token" });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      { sub: "admin-1", email: "presidenta@aeis.app", role: "PRESIDENTE" },
      { expiresIn: "12h" }
    );
    expect(prisma.adminAccount.findUnique).toHaveBeenCalledWith({ where: { email: "presidenta@aeis.app" } });
  });

  it("Dado un correo que no tiene cuenta de administración, Cuando inicia sesión, Entonces rechaza con el MISMO mensaje genérico que una contraseña mala (nunca confirma qué correos existen)", async () => {
    const { service } = await buildService({
      prisma: { adminAccount: { findUnique: jest.fn().mockResolvedValue(null) } },
    });

    await expect(service.login("nadie@aeis.app", "cualquiera")).rejects.toThrow(
      new UnauthorizedException("Correo o contraseña incorrectos")
    );
  });

  it("Dada una cuenta real con la contraseña INCORRECTA, Cuando inicia sesión, Entonces rechaza con el mismo mensaje genérico y nunca firma un JWT", async () => {
    const passwordHash = await bcrypt.hash("correcta123", 10);
    const { service, jwt } = await buildService({
      prisma: {
        adminAccount: {
          findUnique: jest.fn().mockResolvedValue({ id: "admin-1", email: "presidenta@aeis.app", passwordHash, role: "PRESIDENTE" }),
        },
      },
    });

    await expect(service.login("presidenta@aeis.app", "incorrecta")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it("Dado un correo en otras mayúsculas/con espacios, Cuando inicia sesión, Entonces lo normaliza antes de buscar (minúsculas, sin espacios)", async () => {
    const passwordHash = await bcrypt.hash("correcta123", 10);
    const { service, prisma } = await buildService({
      prisma: {
        adminAccount: {
          findUnique: jest.fn().mockResolvedValue({ id: "admin-1", email: "presidenta@aeis.app", passwordHash, role: "PRESIDENTE" }),
        },
      },
    });

    await service.login("  Presidenta@AEIS.app  ", "correcta123");

    expect(prisma.adminAccount.findUnique).toHaveBeenCalledWith({ where: { email: "presidenta@aeis.app" } });
  });
});
