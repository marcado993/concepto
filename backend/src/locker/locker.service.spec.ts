import { Test } from "@nestjs/testing";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { LockerService, LockerUnavailableError } from "./locker.service";
import { PrismaService } from "../shared/prisma/prisma.service";
import { AuditService } from "../shared/audit/audit.service";
import { PayphoneClient } from "../shared/payment/payphone.client";
import { OcrService } from "../shared/ocr/ocr.service";

describe("LockerService.rent", () => {
  let service: LockerService;
  let prisma: any;
  let audit: { record: jest.Mock };
  let payphone: { charge: jest.Mock };
  let ocr: { extractText: jest.Mock };

  const locker = { id: "locker-1", code: "A07", zone: "A", status: "AVAILABLE" };
  const params = { userId: "user-1", lockerCode: "A07", method: "TRANSFER" as const };

  beforeEach(async () => {
    const tx = {
      payment: { create: jest.fn().mockResolvedValue({ id: "payment-1" }), update: jest.fn().mockResolvedValue({}) },
      lockerRental: { create: jest.fn().mockResolvedValue({ id: "rental-1" }) },
      locker: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      locker: { findUnique: jest.fn().mockResolvedValue(locker) },
      period: { findFirst: jest.fn().mockResolvedValue({ id: "period-1" }) },
      lockerRental: { findUnique: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(tx)),
      __tx: tx,
    };
    audit = { record: jest.fn().mockResolvedValue({ id: "log-1" }) };
    payphone = { charge: jest.fn() };
    ocr = { extractText: jest.fn().mockResolvedValue("") };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: PayphoneClient, useValue: payphone },
        { provide: OcrService, useValue: ocr },
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

describe("LockerService.confirmReceipt", () => {
  let service: LockerService;
  let prisma: any;
  let audit: { record: jest.Mock };
  let ocr: { extractText: jest.Mock };

  const pendingRental = {
    id: "rental-1",
    userId: "user-1",
    lockerId: "locker-1",
    paymentId: "payment-1",
    payment: { id: "payment-1", method: "TRANSFER", status: "PENDING", amount: 6.5 },
    locker: { id: "locker-1", code: "A07" },
  };

  beforeEach(async () => {
    const tx = {
      payment: { update: jest.fn().mockResolvedValue({}) },
      locker: { update: jest.fn().mockResolvedValue({ id: "locker-1", status: "RENTED" }) },
    };
    prisma = {
      lockerRental: { findUnique: jest.fn().mockResolvedValue(pendingRental) },
      $transaction: jest.fn((cb: any) => cb(tx)),
      __tx: tx,
    };
    audit = { record: jest.fn().mockResolvedValue({ id: "log-1" }) };
    ocr = { extractText: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LockerService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: PayphoneClient, useValue: { charge: jest.fn() } },
        { provide: OcrService, useValue: ocr },
      ],
    }).compile();
    service = moduleRef.get(LockerService);
  });

  it("Dado un alquiler que no existe, Cuando se confirma el comprobante, Entonces lanza NotFoundException", async () => {
    prisma.lockerRental.findUnique.mockResolvedValue(null);

    await expect(service.confirmReceipt("rental-x", "user-1", Buffer.from(""))).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("Dado un alquiler de otro estudiante, Cuando se confirma el comprobante, Entonces lanza ForbiddenException", async () => {
    await expect(service.confirmReceipt("rental-1", "user-otro", Buffer.from(""))).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });

  it("Dado que el OCR no encuentra el monto esperado en la imagen, Cuando se confirma, Entonces rechaza sin tocar el pago ni el casillero, y audita el rechazo", async () => {
    ocr.extractText.mockResolvedValue("comprobante ilegible");

    await expect(service.confirmReceipt("rental-1", "user-1", Buffer.from("img"))).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locker.receipt.rejected", entityId: "rental-1" })
    );
  });

  it("Dado que el OCR encuentra el monto esperado, Cuando se confirma, Entonces el pago pasa a CONFIRMED y el casillero a RENTED dentro de la misma transacción", async () => {
    ocr.extractText.mockResolvedValue("Transferencia exitosa por $6.50");

    await service.confirmReceipt("rental-1", "user-1", Buffer.from("img"));

    expect(prisma.__tx.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CONFIRMED" }) })
    );
    expect(prisma.__tx.locker.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RENTED" } })
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "locker.receipt.confirmed", entityId: "rental-1" }),
      prisma.__tx
    );
  });

  it("Dado un alquiler ya confirmado, Cuando se intenta confirmar de nuevo, Entonces lanza BadRequestException", async () => {
    prisma.lockerRental.findUnique.mockResolvedValue({
      ...pendingRental,
      payment: { ...pendingRental.payment, status: "CONFIRMED" },
    });

    await expect(service.confirmReceipt("rental-1", "user-1", Buffer.from("img"))).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});
