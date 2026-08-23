import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AlreadySubscribedError, SubscriptionService } from "./subscription.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { PeriodService } from "../shared/period/period.service";

function buildService(overrides: { prisma?: any; audit?: any; payphone?: any; period?: any }) {
  return Test.createTestingModule({
    providers: [
      SubscriptionService,
      { provide: PrismaService, useValue: overrides.prisma ?? {} },
      { provide: AuditService, useValue: overrides.audit ?? { record: jest.fn().mockResolvedValue({}) } },
      { provide: PayphoneClient, useValue: overrides.payphone ?? { confirm: jest.fn(), getPublicConfig: jest.fn() } },
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
    service = await buildService({ prisma, audit });
  });

  it("Dado un tier sin configurar para el periodo activo, Cuando se aporta, Entonces lanza NotFoundException en vez de inventar un monto", async () => {
    prisma.subscriptionTier.findUnique.mockResolvedValue(null);

    await expect(service.subscribe(params)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("Dado un tier vigente, Cuando se aporta, Entonces usa EXACTAMENTE el monto configurado del tier, no un valor fijo en código, y el pago queda como PAYPHONE (único método)", async () => {
    await service.subscribe(params);

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 19.99, method: "PAYPHONE", status: "PENDING" }) })
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

  // "TRANSFER" acá es lectura de un dato HISTÓRICO — esta aportación se
  // hubiera creado antes de que se retirara transferencia como método; el
  // enum de la base de datos sigue reconociendo ese valor a propósito, para
  // no perder el historial real (ver rental-calculator.ts y schema.prisma).
  it("Dado un estudiante con aportación PENDING creada cuando transferencia todavía existía, Cuando consulta la suya, Entonces expone el estado y método históricos tal cual quedaron guardados", async () => {
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue({
          id: "sub-1",
          tier: { name: "Bronce" },
          payment: { amount: new Prisma.Decimal(7.99), method: "TRANSFER", status: "PENDING" },
        }),
      },
    };
    const service = await buildService({ prisma });

    await expect(service.getMine("user-1")).resolves.toEqual(
      expect.objectContaining({ tierName: "Bronce", paymentStatus: "PENDING", method: "TRANSFER" })
    );
  });
});

describe("SubscriptionService.confirmPayphonePayment", () => {
  const pendingSub = {
    id: "sub-1",
    userId: "user-1",
    paymentId: "payment-1",
    payment: { id: "payment-1", method: "PAYPHONE", status: "PENDING", amount: 20.39 },
  };

  function build(payphoneOverrides: any = {}) {
    const tx = { payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const prisma = {
      subscription: { findUnique: jest.fn().mockResolvedValue(pendingSub) },
      $transaction: jest.fn((cb: any) => cb(tx)),
      __tx: tx,
    };
    const payphone = { confirm: jest.fn(), getPublicConfig: jest.fn(), ...payphoneOverrides };
    const audit = { record: jest.fn().mockResolvedValue({}) };
    return buildService({ prisma, payphone, audit }).then((service) => ({ service, prisma, payphone, audit }));
  }

  it("Dado que PayPhone no aprueba la transacción, Cuando se confirma, Entonces rechaza sin tocar el pago", async () => {
    const { service, prisma, payphone } = await build({
      confirm: jest.fn().mockResolvedValue({
        approved: false,
        transactionId: 1,
        clientTransactionId: "sub-1",
        amountCents: 2039,
        raw: {},
      }),
    });

    await expect(service.confirmPayphonePayment("sub-1", 1, "user-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(payphone.confirm).toHaveBeenCalledWith(1, "sub-1");
  });

  // Mismo hallazgo de seguridad que locker.service.spec.ts: un pago real
  // aprobado no debería poder confirmar una aportación distinta a la que
  // de verdad se pagó, aunque el monto coincida (tiers tienen precio fijo).
  it("Dado que PayPhone aprueba una transacción real pero para OTRA aportación distinta (clientTransactionId no coincide), Cuando se confirma, Entonces rechaza sin tocar el pago", async () => {
    const { service, prisma } = await build({
      confirm: jest.fn().mockResolvedValue({
        approved: true,
        transactionId: 1,
        clientTransactionId: "sub-de-otra-aportacion",
        amountCents: 2039,
        raw: {},
      }),
    });

    await expect(service.confirmPayphonePayment("sub-1", 1, "user-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("Dado que PayPhone aprueba con el monto correcto, Cuando se confirma, Entonces el pago pasa a CONFIRMED", async () => {
    const { service, prisma } = await build({
      confirm: jest.fn().mockResolvedValue({
        approved: true,
        transactionId: 1,
        clientTransactionId: "sub-1",
        amountCents: 2039,
        raw: {},
      }),
    });

    await service.confirmPayphonePayment("sub-1", 1, "user-1");

    expect(prisma.__tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CONFIRMED", providerRef: "1" }) })
    );
  });
});
