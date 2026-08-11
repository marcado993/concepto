import { Test } from "@nestjs/testing";
import { AuditService } from "./audit.service";
import { PrismaService } from "../prisma/prisma.service";

describe("AuditService", () => {
  let service: AuditService;
  let prisma: { auditLog: { create: jest.Mock } };

  beforeEach(async () => {
    prisma = { auditLog: { create: jest.fn().mockResolvedValue({ id: "log-1" }) } };
    const moduleRef = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AuditService);
  });

  it("Dado un evento con actor identificado, Cuando se registra, Entonces persiste actorId, acción y entidad", async () => {
    await service.record({
      actorId: "user-1",
      action: "locker.rental.created",
      entityType: "LockerRental",
      entityId: "rental-1",
      metadata: { method: "PAYPHONE" },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: "user-1",
        action: "locker.rental.created",
        entityType: "LockerRental",
        entityId: "rental-1",
      }),
    });
  });

  it("Dado un cliente de transacción explícito, Cuando se registra, Entonces usa ESE cliente y no el PrismaService global (mismo commit/rollback que el alquiler que audita)", async () => {
    const tx = { auditLog: { create: jest.fn().mockResolvedValue({ id: "log-2" }) } } as any;

    await service.record(
      { actorId: "user-1", action: "subscription.created", entityType: "Subscription", entityId: "sub-1" },
      tx
    );

    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});
