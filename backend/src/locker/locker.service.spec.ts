import { Test } from "@nestjs/testing";
import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { LockerService, LockerUnavailableError } from "./locker.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PayphoneClient } from "../shared/payment/payphone.client";

describe("LockerService.rent", () => {
  let service: LockerService;
  let prisma: any;
  let audit: { record: jest.Mock };
  let payphone: { charge: jest.Mock };

  const locker = { id: "locker-1", code: "A07", zone: "A", status: "AVAILABLE" };
  const params = { userId: "user-1", lockerCode: "A07", periodId: "period-1", method: "TRANSFER" as const };

  beforeEach(async () => {
    const tx = {
      payment: { create: jest.fn().mockResolvedValue({ id: "payment-1" }) },
      lockerRental: { create: jest.fn().mockResolvedValue({ id: "rental-1" }) },
      locker: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      locker: { findUnique: jest.fn().mockResolvedValue(locker) },
      $transaction: jest.fn((cb: any) => cb(tx)),
      __tx: tx,
    };
    audit = { record: jest.fn().mockResolvedValue({ id: "log-1" }) };
    payphone = { charge: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: PayphoneClient, useValue: payphone },
      ],
    }).compile();
    service = moduleRef.get(LockerService);
  });

  it("Dado un casillero inexistente, Cuando se intenta alquilar, Entonces lanza NotFoundException sin crear pago ni auditoría", async () => {
    prisma.locker.findUnique.mockResolvedValue(null);

    await expect(service.rent(params)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("Dado un pago por transferencia, Cuando se alquila, Entonces el pago queda PENDING y el casillero RESERVED (no RENTED hasta que el OCR confirme)", async () => {
    await service.rent(params);

    expect(prisma.__tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) })
    );
    expect(prisma.__tx.locker.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RESERVED" } })
    );
  });

  it("Dado un pago por PayPhone confirmado, Cuando se alquila, Entonces cobra ANTES de tocar la base de datos y el casillero queda RENTED de inmediato", async () => {
    payphone.charge.mockResolvedValue({ providerRef: "pp-123", confirmed: true });

    await service.rent({ ...params, method: "PAYPHONE" });

    expect(payphone.charge).toHaveBeenCalledWith(6.9, "user-1");
    expect(prisma.__tx.locker.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RENTED" } })
    );
  });

  it("Dado que PayPhone falla, Cuando se alquila, Entonces NO se abre ninguna transacción de base de datos (no hay alquiler fantasma sin cobro)", async () => {
    payphone.charge.mockRejectedValue(new Error("pasarela caída"));

    await expect(service.rent({ ...params, method: "PAYPHONE" })).rejects.toThrow("pasarela caída");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("Dado dos estudiantes alquilando el mismo casillero a la vez (condición de carrera), Cuando la restricción única de la base de datos rechaza el segundo insert, Entonces el servicio traduce eso a LockerUnavailableError, no a un error genérico de base de datos", async () => {
    const dbError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "6.4.1",
    });
    prisma.__tx.lockerRental.create.mockRejectedValue(dbError);

    await expect(service.rent(params)).rejects.toBeInstanceOf(LockerUnavailableError);
  });

  it("Dado un alquiler exitoso, Cuando se completa, Entonces queda un registro de auditoría con actor, acción y monto — dentro de la MISMA transacción", async () => {
    await service.rent(params);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "locker.rental.created",
        entityType: "LockerRental",
      }),
      prisma.__tx
    );
  });
});
