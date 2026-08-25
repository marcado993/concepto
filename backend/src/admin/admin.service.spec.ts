import { Test } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PeriodService } from "../shared/period/period.service";

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
    subscriptionTier: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), update: jest.fn() },
    period: { update: jest.fn() },
    auditLog: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
  };
}

async function buildService(overrides: { prisma?: any } = {}) {
  const prisma = overrides.prisma ?? makePrismaMock();
  const audit = { record: jest.fn().mockResolvedValue({ id: "log-1" }) };
  const period = { getCurrentPeriod: jest.fn().mockResolvedValue(TEST_PERIOD), getCurrentPeriodId: jest.fn().mockResolvedValue(TEST_PERIOD.id) };

  const moduleRef = await Test.createTestingModule({
    providers: [
      AdminService,
      { provide: PrismaService, useValue: prisma },
      { provide: AuditService, useValue: audit },
      { provide: PeriodService, useValue: period },
    ],
  }).compile();

  return { service: moduleRef.get(AdminService), prisma, audit, period };
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

    const result = await service.updateSubscriptionTier("tier-1", { amount: 24.99 }, { actorId: "admin-1", ipAddress: "1.2.3.4" });

    expect(result.amount).toBe(24.99);
    expect(prisma.subscriptionTier.update).toHaveBeenCalledWith({ where: { id: "tier-1" }, data: { amount: 24.99 } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "admin-1",
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

    await service.updateSubscriptionTier("tier-1", { benefits: newBenefits }, { actorId: "admin-1" });

    expect(prisma.subscriptionTier.update).toHaveBeenCalledWith({ where: { id: "tier-1" }, data: { benefits: newBenefits } });
  });

  it("Dado un beneficio sin 'type' (basura), Cuando se actualiza, Entonces rechaza con BadRequestException sin llegar a la base de datos", async () => {
    const { service, prisma } = await buildService();
    prisma.subscriptionTier.findUnique.mockResolvedValue(existingTier);

    await expect(
      service.updateSubscriptionTier("tier-1", { benefits: [{ percent: 10 }] }, { actorId: "admin-1" })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.subscriptionTier.update).not.toHaveBeenCalled();
  });

  it("Dado un tier que pertenece a OTRO periodo (histórico), Cuando se intenta editar, Entonces lanza NotFoundException — nunca se reescribe un monto ya cobrado en el pasado", async () => {
    const { service, prisma } = await buildService();
    prisma.subscriptionTier.findUnique.mockResolvedValue({ ...existingTier, periodId: "period-vieja" });

    await expect(service.updateSubscriptionTier("tier-1", { amount: 1 }, { actorId: "admin-1" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("Dado un tier inexistente, Cuando se intenta editar, Entonces lanza NotFoundException", async () => {
    const { service, prisma } = await buildService();
    prisma.subscriptionTier.findUnique.mockResolvedValue(null);

    await expect(service.updateSubscriptionTier("no-existe", { amount: 1 }, { actorId: "admin-1" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("Dado un DTO vacío (ni amount ni benefits), Cuando se actualiza, Entonces rechaza con BadRequestException", async () => {
    const { service } = await buildService();

    await expect(service.updateSubscriptionTier("tier-1", {}, { actorId: "admin-1" })).rejects.toBeInstanceOf(BadRequestException);
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

    const result = await service.updateLockerPricing({ basePrice: 7.5 }, { actorId: "admin-1", ipAddress: "1.2.3.4" });

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
