import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AlreadySubscribedError, SubscriptionService } from "./subscription.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";

describe("SubscriptionService.subscribe", () => {
  let service: SubscriptionService;
  let prisma: any;
  let audit: { record: jest.Mock };

  const tier = { id: "tier-platino", name: "Platino", amount: new Prisma.Decimal(19.99), periodId: "period-1" };
  const params = {
    userId: "user-1",
    periodId: "period-1",
    tierName: "Platino" as const,
    method: "TRANSFER" as const,
  };

  beforeEach(async () => {
    const tx = {
      payment: { create: jest.fn().mockResolvedValue({ id: "payment-1" }) },
      subscription: { create: jest.fn().mockResolvedValue({ id: "sub-1" }) },
    };
    prisma = {
      subscriptionTier: { findUnique: jest.fn().mockResolvedValue(tier) },
      $transaction: jest.fn((cb: any) => cb(tx)),
      __tx: tx,
    };
    audit = { record: jest.fn().mockResolvedValue({ id: "log-1" }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = moduleRef.get(SubscriptionService);
  });

  it("Dado un tier sin configurar para el periodo activo, Cuando se aporta, Entonces lanza NotFoundException en vez de inventar un monto", async () => {
    prisma.subscriptionTier.findUnique.mockResolvedValue(null);

    await expect(service.subscribe(params)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("Dado un tier vigente, Cuando se aporta por transferencia, Entonces usa EXACTAMENTE el monto configurado del tier, no un valor fijo en código", async () => {
    await service.subscribe(params);

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 19.99 }) })
    );
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
