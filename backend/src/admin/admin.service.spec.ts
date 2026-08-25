import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PeriodService } from "../shared/period/period.service";
import { UiVariantService } from "../shared/settings/ui-variant.service";

const TEST_PERIOD = {
  id: "period-1",
  label: "2026-B",
  startsAt: new Date("2026-09-01T00:00:00Z"),
  endsAt: new Date("2027-02-28T00:00:00Z"),
  lockerBasePrice: 6.5,
};

function makePrismaMock() {
  return {
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    user: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
    locker: { findMany: jest.fn().mockResolvedValue([]) },
    payment: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }) },
    subscriptionTier: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn() },
    period: { update: jest.fn() },
    auditLog: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
  };
}

async function buildService(overrides: { prisma?: any } = {}) {
  const prisma = overrides.prisma ?? makePrismaMock();
  const audit = { record: jest.fn().mockResolvedValue({ id: "log-1" }) };
  const period = { getCurrentPeriod: jest.fn().mockResolvedValue(TEST_PERIOD), getCurrentPeriodId: jest.fn().mockResolvedValue(TEST_PERIOD.id) };
  const uiVariant = { get: jest.fn().mockResolvedValue("B"), set: jest.fn().mockResolvedValue(undefined) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      AdminService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: audit },
      { provide: PeriodService, useValue: period },
      { provide: UiVariantService, useValue: uiVariant },
    ],
  }).compile();

  return { service: moduleRef.get(AdminService), prisma, audit, period, uiVariant };
}

describe("AdminService.listUsers", () => {
  it("Dado dos estudiantes registrados, Cuando se lista sin filtro, Entonces trae total/page/pageSize y nunca logtoSub (select explícito)", async () => {
    const { service, prisma } = await buildService();
    prisma.user.count.mockResolvedValue(2);
    prisma.user.findMany.mockResolvedValue([
      { id: "u1", fullName: "Luis Guerrero", email: "luis@epn.edu.ec", uniqueCode: "AEIS-001", role: "ESTUDIANTE", cedula: "1723456789", phone: "0991234567", createdAt: new Date() },
    ]);

    const result = await service.listUsers({ page: 1, pageSize: 30 });

    expect(result.total).toBe(2);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, fullName: true, email: true, uniqueCode: true, role: true, cedula: true, phone: true, createdAt: true },
      })
    );
  });

  it("Dado un texto de búsqueda, Cuando se lista, Entonces filtra por nombre/correo/código único (insensible a mayúsculas)", async () => {
    const { service, prisma } = await buildService();

    await service.listUsers({ page: 1, pageSize: 30, search: "luis" });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { fullName: { contains: "luis", mode: "insensitive" } },
            { email: { contains: "luis", mode: "insensitive" } },
            { uniqueCode: { contains: "luis", mode: "insensitive" } },
          ],
        },
      })
    );
  });

  it("Dado page 2 con pageSize 10, Cuando se lista, Entonces pagina con skip/take correctos", async () => {
    const { service, prisma } = await buildService();

    await service.listUsers({ page: 2, pageSize: 10 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 10 }));
  });
});

describe("AdminService.updateSubscriptionTier", () => {
  const existingTier = { id: "tier-1", periodId: TEST_PERIOD.id, name: "Platino", amount: 19.99, benefits: [{ type: "descuento_casillero", percent: 10 }] };

  it("Dado un monto nuevo, Cuando se actualiza, Entonces guarda EXACTAMENTE ese monto y audita admin.subscription_tier.updated con before/after", async () => {
    const { service, prisma, audit } = await buildService();
    prisma.subscriptionTier.findUnique.mockResolvedValue(existingTier);
    prisma.subscriptionTier.update.mockResolvedValue({ ...existingTier, amount: 24.99 });

    const result = await service.updateSubscriptionTier("tier-1", { amount: 24.99 }, { adminActorId: "admin-1", ipAddress: "1.2.3.4" });

    expect(result.amount).toBe(24.99);
    expect(prisma.subscriptionTier.update).toHaveBeenCalledWith({ where: { id: "tier-1" }, data: { amount: 24.99 } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        adminActorId: "admin-1",
        action: "admin.subscription_tier.updated",
        entityType: "SubscriptionTier",
        entityId: "tier-1",
        metadata: expect.objectContaining({ tierName: "Platino", before: { amount: 19.99, benefits: existingTier.benefits } }),
      })
    );
  });

  it("Dados beneficios nuevos válidos, Cuando se actualiza, Entonces los guarda tal cual (forma libre, no se recorta ningún campo)", async () => {
    const { service, prisma } = await buildService();
    prisma.subscriptionTier.findUnique.mockResolvedValue(existingTier);
    const newBenefits = [{ type: "descuento_casillero", percent: 25 }, { type: "acceso_ps4", included: true }];
    prisma.subscriptionTier.update.mockResolvedValue({ ...existingTier, benefits: newBenefits });

    await service.updateSubscriptionTier("tier-1", { benefits: newBenefits }, { adminActorId: "admin-1" });

    expect(prisma.subscriptionTier.update).toHaveBeenCalledWith({ where: { id: "tier-1" }, data: { benefits: newBenefits } });
  });

  it("Dado un beneficio sin 'type' (basura), Cuando se actualiza, Entonces rechaza con BadRequestException sin llegar a la base de datos", async () => {
    const { service, prisma } = await buildService();
    prisma.subscriptionTier.findUnique.mockResolvedValue(existingTier);

    await expect(
      service.updateSubscriptionTier("tier-1", { benefits: [{ percent: 10 }] }, { adminActorId: "admin-1" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.subscriptionTier.update).not.toHaveBeenCalled();
  });

  it("Dado un tier que pertenece a OTRO periodo (histórico), Cuando se intenta editar, Entonces lanza NotFoundException — nunca se reescribe un monto ya cobrado en el pasado", async () => {
    const { service, prisma } = await buildService();
    prisma.subscriptionTier.findUnique.mockResolvedValue({ ...existingTier, periodId: "period-vieja" });

    await expect(service.updateSubscriptionTier("tier-1", { amount: 1 }, { adminActorId: "admin-1" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("Dado un tier inexistente, Cuando se intenta editar, Entonces lanza NotFoundException", async () => {
    const { service, prisma } = await buildService();
    prisma.subscriptionTier.findUnique.mockResolvedValue(null);

    await expect(service.updateSubscriptionTier("no-existe", { amount: 1 }, { adminActorId: "admin-1" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("Dado un DTO vacío (ni amount ni benefits), Cuando se actualiza, Entonces rechaza con BadRequestException", async () => {
    const { service } = await buildService();

    await expect(service.updateSubscriptionTier("tier-1", {}, { adminActorId: "admin-1" })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("AdminService.getLockerPricing / updateLockerPricing", () => {
  it("Dado el periodo activo, Cuando se pide el precio, Entonces devuelve el lockerBasePrice real de ese periodo, no una constante fija", async () => {
    const { service } = await buildService();

    const result = await service.getLockerPricing();

    expect(result).toEqual({ periodLabel: "2026-B", basePrice: 6.5 });
  });

  it("Dado un precio nuevo dentro de rango, Cuando se actualiza, Entonces guarda en el periodo activo y audita admin.locker_pricing.updated con before/after", async () => {
    const { service, prisma, audit } = await buildService();
    prisma.period.update.mockResolvedValue({ ...TEST_PERIOD, lockerBasePrice: 7.5 });

    const result = await service.updateLockerPricing({ basePrice: 7.5 }, { adminActorId: "admin-1", ipAddress: "1.2.3.4" });

    expect(result.basePrice).toBe(7.5);
    expect(prisma.period.update).toHaveBeenCalledWith({ where: { id: TEST_PERIOD.id }, data: { lockerBasePrice: 7.5 } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "admin.locker_pricing.updated",
        entityType: "Period",
        entityId: TEST_PERIOD.id,
        metadata: { periodLabel: "2026-B", before: 6.5, after: 7.5 },
      })
    );
  });
});

describe("AdminService.listAuditLogs", () => {
  it("Dados registros de auditoría reales, Cuando se listan, Entonces trae el nombre del actor (join) y nunca solo su id críptico", async () => {
    const { service, prisma } = await buildService();
    prisma.auditLog.count.mockResolvedValue(1);
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: "log-1",
        action: "locker.rental.created",
        entityType: "LockerRental",
        entityId: "rental-1",
        actorId: "user-1",
        actor: { fullName: "Luis Guerrero" },
        ipAddress: "1.2.3.4",
        metadata: { lockerCode: "A07" },
        createdAt: new Date("2026-08-24T10:00:00Z"),
      },
    ]);

    const result = await service.listAuditLogs({ page: 1, pageSize: 30 });

    expect(result.logs[0]).toEqual(
      expect.objectContaining({ action: "locker.rental.created", actorName: "Luis Guerrero", actorId: "user-1" })
    );
  });

  it("Dado un evento generado desde el PANEL (adminActor, no actor — ver admin-auth), Cuando se lista, Entonces muestra el correo del admin en vez de reventar leyendo actor.fullName de null", async () => {
    const { service, prisma } = await buildService();
    prisma.auditLog.count.mockResolvedValue(1);
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: "log-2",
        action: "admin.locker_pricing.updated",
        entityType: "Period",
        entityId: "period-1",
        actorId: null,
        actor: null,
        adminActorId: "admin-1",
        adminActor: { email: "presidenta@aeis.app" },
        ipAddress: "1.2.3.4",
        metadata: { before: 6.5, after: 7.5 },
        createdAt: new Date("2026-08-25T10:00:00Z"),
      },
    ]);

    const result = await service.listAuditLogs({ page: 1, pageSize: 30 });

    expect(result.logs[0]).toEqual(
      expect.objectContaining({ actorId: "admin-1", actorName: "presidenta@aeis.app (admin)" })
    );
  });

  it("Dado un filtro por acción, Cuando se listan, Entonces filtra con contains insensible a mayúsculas", async () => {
    const { service, prisma } = await buildService();

    await service.listAuditLogs({ page: 1, pageSize: 30, action: "locker" });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: { contains: "locker", mode: "insensitive" } } })
    );
  });

  it("Dado un filtro por actorId, Cuando se listan, Entonces filtra por ese actor exacto", async () => {
    const { service, prisma } = await buildService();

    await service.listAuditLogs({ page: 1, pageSize: 30, actorId: "user-1" });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { actorId: "user-1" } }));
  });
});

describe("AdminService.getUiVariant / updateUiVariant", () => {
  it("Dado el flag actual, Cuando se pide, Entonces devuelve el valor real de UiVariantService", async () => {
    const { service, uiVariant } = await buildService();
    uiVariant.get.mockResolvedValue("A");

    const result = await service.getUiVariant();

    expect(result).toEqual({ variant: "A" });
  });

  it("Dado un cambio a rueda (A), Cuando se actualiza, Entonces lo guarda y audita admin.ui_variant.updated", async () => {
    const { service, uiVariant, audit } = await buildService();

    const result = await service.updateUiVariant({ variant: "A" }, { adminActorId: "admin-1", ipAddress: "1.2.3.4" });

    expect(result).toEqual({ variant: "A" });
    expect(uiVariant.set).toHaveBeenCalledWith("A");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        adminActorId: "admin-1",
        action: "admin.ui_variant.updated",
        entityType: "AppSetting",
        entityId: "ui_variant",
        metadata: { variant: "A" },
      })
    );
  });
});

describe("AdminService.getOverview", () => {
  it("Dado casilleros en distintos status, Cuando se pide el resumen, Entonces cuenta ocupación correctamente", async () => {
    const prisma = makePrismaMock();
    prisma.locker.findMany.mockResolvedValue([
      { status: "RENTED" },
      { status: "RENTED" },
      { status: "RESERVED" },
      { status: "AVAILABLE" },
      { status: "AVAILABLE" },
      { status: "AVAILABLE" },
    ]);
    const { service } = await buildService({ prisma });

    const result = await service.getOverview();

    expect(result.lockers.total).toBe(6);
    expect(result.lockers.rented).toBe(2);
    expect(result.lockers.reserved).toBe(1);
    expect(result.lockers.available).toBe(3);
    expect(result.lockers.basePrice).toBe(6.5);
  });

  it("Dado pagos de casillero CONFIRMED, Cuando se pide el resumen, Entonces suma solo lo confirmado", async () => {
    const prisma = makePrismaMock();
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 45.5 } });
    const { service } = await buildService({ prisma });

    const result = await service.getOverview();

    expect(result.lockers.revenueConfirmed).toBe(45.5);
    expect(prisma.payment.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "CONFIRMED", rental: { periodId: TEST_PERIOD.id } },
      })
    );
  });

  it("Dado tiers con suscriptores confirmados, Cuando se pide el resumen, Entonces calcula conteo e ingreso por tier", async () => {
    const prisma = makePrismaMock();
    prisma.subscriptionTier.findMany.mockResolvedValue([
      {
        id: "tier-1",
        name: "Básico",
        amount: 10,
        subscriptions: [{ payment: { amount: 10 } }, { payment: { amount: 10 } }],
      },
      {
        id: "tier-2",
        name: "Premium",
        amount: 20,
        subscriptions: [{ payment: { amount: 20 } }],
      },
    ]);
    const { service } = await buildService({ prisma });

    const result = await service.getOverview();

    expect(result.subscriptions.tiers).toEqual([
      { id: "tier-1", name: "Básico", amount: 10, subscriberCount: 2, revenueConfirmed: 20 },
      { id: "tier-2", name: "Premium", amount: 20, subscriberCount: 1, revenueConfirmed: 20 },
    ]);
    expect(result.subscriptions.revenueConfirmed).toBe(40);
  });

  it("Dado ingresos de casilleros y de tiers, Cuando se pide el resumen, Entonces totalRevenueConfirmed es la suma de ambos", async () => {
    const prisma = makePrismaMock();
    prisma.payment.aggregate.mockResolvedValue({ _sum: { amount: 30 } });
    prisma.subscriptionTier.findMany.mockResolvedValue([
      { id: "tier-1", name: "Básico", amount: 10, subscriptions: [{ payment: { amount: 10 } }] },
    ]);
    const { service } = await buildService({ prisma });

    const result = await service.getOverview();

    expect(result.totalRevenueConfirmed).toBe(40);
    expect(result.periodLabel).toBe(TEST_PERIOD.label);
  });

  it("Dado ningún pago confirmado, Cuando se pide el resumen, Entonces los ingresos son 0 en vez de null/NaN", async () => {
    const { service } = await buildService();

    const result = await service.getOverview();

    expect(result.lockers.revenueConfirmed).toBe(0);
    expect(result.subscriptions.revenueConfirmed).toBe(0);
    expect(result.totalRevenueConfirmed).toBe(0);
  });
});
