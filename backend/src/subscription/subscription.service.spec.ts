import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AlreadySubscribedError, SubscriptionService } from "./subscription.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PeriodService } from "../shared/period/period.service";

function buildService(overrides: { prisma?: any; audit?: any; period?: any }) {
  return Test.createTestingModule({
    providers: [
      SubscriptionService,
      { provide: PrismaService, useValue: overrides.prisma ?? {} },
      { provide: AuditService, useValue: overrides.audit ?? { record: jest.fn().mockResolvedValue({}) } },
      {
        provide: PeriodService,
        useValue: overrides.period ?? { getCurrentPeriodId: jest.fn().mockResolvedValue("period-1") },
      },
    ],
  })
    .compile()
    .then((moduleRef) => moduleRef.get(SubscriptionService));
}

describe("SubscriptionService.subscribe", () => {
  let service: SubscriptionService;
  let prisma: any;
  let audit: { record: jest.Mock };

  const tier = { id: "tier-platino", name: "Platino", amount: new Prisma.Decimal(19.99), periodId: "period-1" };
  const params = {
    userId: "user-1",
    tierName: "Platino" as const,
    fullName: "Luis Andres Guerrero",
  };

  beforeEach(async () => {
    const tx = {
      payment: { create: jest.fn().mockResolvedValue({ id: "payment-1" }) },
      subscription: { create: jest.fn().mockResolvedValue({ id: "sub-1" }) },
    };
    prisma = {
      subscriptionTier: { findUnique: jest.fn().mockResolvedValue(tier) },
      user: { update: jest.fn().mockResolvedValue({ id: "user-1" }) },
      $transaction: jest.fn((cb: any) => cb(tx)),
      __tx: tx,
    };
    audit = { record: jest.fn().mockResolvedValue({ id: "log-1" }) };
    service = await buildService({ prisma, audit });
  });

  it("Dado un tier sin configurar para el periodo activo, Cuando se aporta, Entonces lanza NotFoundException en vez de inventar un monto", async () => {
    prisma.subscriptionTier.findUnique.mockResolvedValue(null);

    await expect(service.subscribe(params)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // Aportaciones son informativas — sin pasarela real (decisión de negocio,
  // ver el comentario grande en subscription.service.ts). A diferencia de
  // lockers, el Payment se crea YA CONFIRMED, method INFORMATIVE — nunca
  // queda un estado intermedio "esperando PayPhone" porque no hay PayPhone
  // en este flujo.
  it("Dado un tier vigente, Cuando se aporta, Entonces usa EXACTAMENTE el monto configurado del tier y el pago queda CONFIRMED de una vez, method INFORMATIVE (sin pasarela)", async () => {
    await service.subscribe(params);

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 19.99, method: "INFORMATIVE", status: "CONFIRMED", confirmedAt: expect.any(Date) }),
      })
    );
  });

  // Bug real reportado: aportar nunca pedía el nombre completo — quien
  // SOLO aportaba (nunca alquiló un casillero) se quedaba con el
  // placeholder interno para siempre (que llegó a ser literalmente el
  // correo del estudiante, ver PENDING_FULL_NAME en auth.service.ts).
  it("Dado un nombre completo, Cuando se aporta, Entonces lo guarda en User — no solo lockers confirma la identidad real", async () => {
    await service.subscribe(params);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { fullName: "Luis Andres Guerrero" },
    });
  });

  it("Dado que el estudiante ya tiene una aportación activa este periodo, Cuando intenta aportar de nuevo, Entonces la restricción única lo traduce a AlreadySubscribedError", async () => {
    const dbError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.4.1",
    });
    prisma.__tx.subscription.create.mockRejectedValue(dbError);

    await expect(service.subscribe(params)).rejects.toBeInstanceOf(AlreadySubscribedError);
  });

  it("Dado un aporte exitoso, Cuando se completa, Entonces queda auditado con el nombre del tier y el monto real cobrado", async () => {
    await service.subscribe(params);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "subscription.created",
        metadata: expect.objectContaining({ tierName: "Platino", amount: 19.99 }),
      }),
      prisma.__tx
    );
  });
});

describe("SubscriptionService.listTiers / getMine", () => {
  it("Dado tiers configurados para el periodo activo, Cuando se listan, Entonces filtra por el periodo actual y ordena por monto", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { subscriptionTier: { findMany } };
    const service = await buildService({ prisma });

    await service.listTiers();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { periodId: "period-1" }, orderBy: { amount: "asc" } })
    );
  });

  it("Dado un estudiante sin aportación este periodo, Cuando consulta la suya, Entonces retorna null en vez de un 404", async () => {
    const prisma = { subscription: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = await buildService({ prisma });

    await expect(service.getMine("user-1")).resolves.toBeNull();
  });

  // "TRANSFER"/"PAYPHONE" acá son lectura de datos HISTÓRICOS — esta
  // aportación se hubiera creado antes de que se retirara la pasarela real
  // de aportaciones (ver el comentario grande en subscription.service.ts).
  // El enum de la base de datos sigue reconociendo esos valores a
  // propósito, para no perder el historial real de lo que de verdad pasó
  // en su momento (ver schema.prisma).
  it("Dado un estudiante con aportación creada cuando PayPhone todavía aplicaba a aportaciones, Cuando consulta la suya, Entonces expone el estado y método históricos tal cual quedaron guardados", async () => {
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: "sub-1",
          tier: { name: "Bronce" },
          payment: { amount: new Prisma.Decimal(7.99), method: "PAYPHONE", status: "CONFIRMED" },
        }),
      },
    };
    const service = await buildService({ prisma });

    await expect(service.getMine("user-1")).resolves.toEqual(
      expect.objectContaining({ tierName: "Bronce", paymentStatus: "CONFIRMED", method: "PAYPHONE" })
    );
  });
});
